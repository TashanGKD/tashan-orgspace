import { createHash, randomUUID } from "node:crypto";
import { PartnerInteractionAddRequest } from "@tashan/contracts";
import { AuthError } from "../auth/auth-errors.js";
import { CollaborationRepository } from "../collaboration/collaboration-repository.js";
import type { TransactionClient } from "../db/transaction.js";
import { requireFilePermission } from "../files/file-authorization.js";
import { WorkService } from "../work/work-service.js";
import type { PartnerService } from "./partner-service.js";

interface InteractionRow {
  id: string;
  partner_id: string;
  organization_id: string;
  contacted_at: Date;
  channel: string;
  summary: string;
  recorded_by_account_id: string;
  requires_follow_up: boolean;
  next_follow_up_at: Date | null;
  corrects_interaction_id: string | null;
  follow_up_work_item_id: string | null;
  idempotency_key: string;
  request_hash: string;
  created_at: Date;
}

export class InteractionService {
  private readonly work = new WorkService();
  private readonly collaboration = new CollaborationRepository();
  public constructor(private readonly partners: PartnerService) {}
  private publicRow(row: InteractionRow) {
    return {
      id: row.id,
      partnerId: row.partner_id,
      organizationId: row.organization_id,
      contactedAt: row.contacted_at.toISOString(),
      channel: row.channel,
      summary: row.summary,
      recordedByAccountId: row.recorded_by_account_id,
      requiresFollowUp: row.requires_follow_up,
      nextFollowUpAt: row.next_follow_up_at?.toISOString() ?? null,
      correctsInteractionId: row.corrects_interaction_id,
      followUpWorkItemId: row.follow_up_work_item_id,
      createdAt: row.created_at.toISOString(),
    };
  }
  public async list(
    tx: TransactionClient,
    accountId: string,
    organizationId: string,
    partnerId: string,
  ) {
    await this.partners.read(tx, accountId, organizationId, partnerId);
    const rows = await tx<
      InteractionRow[]
    >`select * from partner_interactions where partner_id=${partnerId} and organization_id=${organizationId} order by contacted_at,created_at,id`;
    return rows.map((row) => this.publicRow(row));
  }
  public async add(
    tx: TransactionClient,
    accountId: string,
    organizationId: string,
    partnerId: string,
    raw: unknown,
    idempotencyKey: string,
  ) {
    if (!idempotencyKey.trim() || idempotencyKey.length > 200)
      throw new AuthError("VALIDATION_FAILED", "valid idempotency key required");
    const input = PartnerInteractionAddRequest.parse(raw);
    const partner = await this.partners.read(tx, accountId, organizationId, partnerId);
    const requestHash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
    const [existing] = await tx<
      InteractionRow[]
    >`select * from partner_interactions where partner_id=${partnerId} and idempotency_key=${idempotencyKey}`;
    if (existing) {
      if (existing.request_hash !== requestHash)
        throw new AuthError("IDEMPOTENCY_CONFLICT", "idempotency key input differs");
      return this.publicRow(existing);
    }
    if (input.correctsInteractionId) {
      const [corrected] = await tx<
        { id: string }[]
      >`select id from partner_interactions where id=${input.correctsInteractionId} and partner_id=${partnerId} and organization_id=${organizationId}`;
      if (!corrected)
        throw new AuthError("PARTNER_FORBIDDEN", "interaction correction is unavailable");
    }
    for (const link of input.links) await this.validateLink(tx, accountId, organizationId, link);
    const id = randomUUID();
    let followUpWorkItemId: string | null = null;
    if (input.followUp) {
      const work = await this.work.create(tx, accountId, organizationId, {
        type: input.followUp.type,
        title: input.followUp.title,
        description: `合作方跟进：${partner.name}`,
        priority: "normal",
        dueAt: input.followUp.dueAt,
        meetingStartsAt: input.followUp.meetingStartsAt,
        assigneeAccountIds: [partner.ownerAccountId],
      });
      followUpWorkItemId = work.item.id;
    }
    const [row] = await tx<
      InteractionRow[]
    >`insert into partner_interactions(id,partner_id,organization_id,contacted_at,channel,summary,recorded_by_account_id,requires_follow_up,next_follow_up_at,corrects_interaction_id,follow_up_work_item_id,idempotency_key,request_hash) values(${id},${partnerId},${organizationId},${input.contactedAt},${input.channel},${input.summary},${accountId},${input.requiresFollowUp},${input.nextFollowUpAt ?? null},${input.correctsInteractionId ?? null},${followUpWorkItemId},${idempotencyKey},${requestHash}) returning *`;
    if (!row) throw new Error("interaction insert failed");
    const interactionRef = {
      organizationId,
      resourceType: "partner_interaction" as const,
      resourceId: id,
    };
    await this.collaboration.registerResource(tx, interactionRef);
    for (const link of input.links)
      await this.linkBoth(
        tx,
        accountId,
        interactionRef,
        link.type === "file"
          ? { organizationId, resourceType: "file" as const, resourceId: link.entryId }
          : { organizationId, resourceType: "work_item" as const, resourceId: link.workItemId },
        link.type,
      );
    if (followUpWorkItemId)
      await this.linkBoth(
        tx,
        accountId,
        interactionRef,
        { organizationId, resourceType: "work_item", resourceId: followUpWorkItemId },
        "follow_up",
      );
    const [version] = await tx<
      { version: number }[]
    >`update partners set version=version+1,last_contact_at=${input.contactedAt},next_follow_up_at=coalesce(${input.nextFollowUpAt ?? null},next_follow_up_at),updated_at=now() where id=${partnerId} returning version`;
    if (!version) throw new Error("partner interaction version failed");
    await this.collaboration.appendDomainEvent(tx, {
      accountId,
      aggregate: { organizationId, resourceType: "partner", resourceId: partnerId },
      sequence: version.version,
      eventType: input.correctsInteractionId
        ? "partner.interaction_corrected"
        : "partner.interaction_added",
      schemaVersion: 1,
      payload: { interactionId: id, followUpWorkItemId },
    });
    return this.publicRow(row);
  }
  private async validateLink(
    tx: TransactionClient,
    accountId: string,
    organizationId: string,
    link:
      | { type: "file"; spaceId: string; entryId: string }
      | { type: "task" | "meeting"; workItemId: string },
  ) {
    try {
      if (link.type === "file")
        await requireFilePermission(tx, {
          accountId,
          spaceId: link.spaceId,
          entryId: link.entryId,
          permission: "read",
        });
      else {
        const [work] = await tx<
          { type: string }[]
        >`select type from work_items where id=${link.workItemId} and organization_id=${organizationId}`;
        if (!work || work.type !== link.type) throw new Error();
      }
    } catch {
      throw new AuthError("PARTNER_FORBIDDEN", "linked resource is unavailable");
    }
  }
  private async linkBoth(
    tx: TransactionClient,
    accountId: string,
    source: { organizationId: string; resourceType: "partner_interaction"; resourceId: string },
    target: { organizationId: string; resourceType: "file" | "work_item"; resourceId: string },
    relationType: string,
  ) {
    await this.collaboration.registerResource(tx, target);
    await this.collaboration.createLink(tx, { accountId, source, target, relationType });
    await this.collaboration.createLink(tx, {
      accountId,
      source: target,
      target: source,
      relationType: `${relationType}_of`,
    });
  }
}
