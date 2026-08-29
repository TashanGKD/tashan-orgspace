import { PartnerLinkRequest } from "@tashan/contracts";
import { AuthError } from "../auth/auth-errors.js";
import { CollaborationRepository } from "../collaboration/collaboration-repository.js";
import type { TransactionClient } from "../db/transaction.js";
import { requireFilePermission } from "../files/file-authorization.js";
import type { PartnerService } from "./partner-service.js";

export class PartnerLinkService {
  private readonly collaboration = new CollaborationRepository();
  public constructor(private readonly partners: PartnerService) {}
  public async link(
    tx: TransactionClient,
    accountId: string,
    organizationId: string,
    partnerId: string,
    raw: unknown,
  ) {
    await this.partners.read(tx, accountId, organizationId, partnerId);
    const input = PartnerLinkRequest.parse(raw);
    const target =
      input.type === "file"
        ? await this.fileTarget(tx, accountId, organizationId, input)
        : await this.workTarget(tx, organizationId, input);
    const partner = { organizationId, resourceType: "partner" as const, resourceId: partnerId };
    await this.collaboration.registerResource(tx, target);
    const link = await this.collaboration.createLink(tx, {
      accountId,
      source: partner,
      target,
      relationType: input.type,
    });
    const reverse = await this.collaboration.createLink(tx, {
      accountId,
      source: target,
      target: partner,
      relationType: `${input.type}_of`,
    });
    return { linkId: link.id, reverseLinkId: reverse.id };
  }
  public async unlink(
    tx: TransactionClient,
    accountId: string,
    organizationId: string,
    partnerId: string,
    linkId: string,
  ) {
    await this.partners.read(tx, accountId, organizationId, partnerId);
    const [link] = await tx<
      {
        id: string;
        source_type: string;
        source_id: string;
        target_type: string;
        target_id: string;
        relation_type: string;
      }[]
    >`select id,source_type,source_id,target_type,target_id,relation_type from resource_links where id=${linkId} and organization_id=${organizationId} and source_type='partner' and source_id=${partnerId}`;
    if (!link) throw new AuthError("PARTNER_NOT_FOUND", "link is unavailable");
    await tx`delete from resource_links where organization_id=${organizationId} and ((id=${linkId}) or (source_type=${link.target_type} and source_id=${link.target_id} and target_type='partner' and target_id=${partnerId} and relation_type=${`${link.relation_type}_of`}))`;
    return { removed: true as const };
  }
  private async fileTarget(
    tx: TransactionClient,
    accountId: string,
    organizationId: string,
    input: { type: "file"; spaceId: string; entryId: string },
  ) {
    try {
      const access = await requireFilePermission(tx, {
        accountId,
        spaceId: input.spaceId,
        entryId: input.entryId,
        permission: "read",
      });
      if (access.space.organization_id !== organizationId) throw new Error();
      return { organizationId, resourceType: "file" as const, resourceId: input.entryId };
    } catch {
      throw new AuthError("PARTNER_FORBIDDEN", "linked file is unavailable");
    }
  }
  private async workTarget(
    tx: TransactionClient,
    organizationId: string,
    input: { type: "task" | "meeting"; workItemId: string },
  ) {
    const [row] = await tx<
      { type: string }[]
    >`select type from work_items where id=${input.workItemId} and organization_id=${organizationId}`;
    if (!row || row.type !== input.type)
      throw new AuthError("PARTNER_FORBIDDEN", "linked work is unavailable");
    return { organizationId, resourceType: "work_item" as const, resourceId: input.workItemId };
  }
}
