import { randomUUID } from "node:crypto";
import type { JSONValue } from "postgres";
import {
  PartnerBulkTransferRequest,
  PartnerCreateRequest,
  PartnerListQuery,
  PartnerTransferRequest,
  PartnerUpdateRequest,
  PartnerVersionRequest,
} from "@tashan/contracts";
import { AuthError } from "../auth/auth-errors.js";
import { CollaborationRepository } from "../collaboration/collaboration-repository.js";
import type { TransactionClient } from "../db/transaction.js";
import {
  requireOrganizationMembership,
  type MembershipRole,
} from "../organizations/authorization.js";
import {
  OwnedOrganizationRecordPolicy,
  OwnedRecordUnavailableError,
} from "../authorization/owned-record-policy.js";
import { BlindIndex } from "../security/blind-index.js";
import {
  SensitiveFieldCipher,
  type SensitiveFieldEnvelope,
} from "../security/sensitive-field-cipher.js";

interface PartnerRow {
  id: string;
  organization_id: string;
  owner_account_id: string;
  created_by_account_id: string;
  name: string;
  organization_name: string | null;
  department: string | null;
  job_title: string | null;
  address_cipher: SensitiveFieldEnvelope | null;
  phone_cipher: SensitiveFieldEnvelope | null;
  wechat_cipher: SensitiveFieldEnvelope | null;
  email_cipher: SensitiveFieldEnvelope | null;
  phone_blind_index: string | null;
  wechat_blind_index: string | null;
  email_blind_index: string | null;
  cooperation_stage: "lead" | "contacting" | "active" | "paused" | "ended";
  tags: string[];
  notes: string | null;
  last_contact_at: Date | null;
  next_follow_up_at: Date | null;
  record_state: "active" | "archived" | "awaiting_owner";
  version: number;
  created_at: Date;
  updated_at: Date;
}

export class PartnerService {
  private readonly policy = new OwnedOrganizationRecordPolicy();
  private readonly collaboration = new CollaborationRepository();
  public constructor(
    private readonly security: { cipher: SensitiveFieldCipher; blindIndex: BlindIndex },
  ) {}

  private async actor(tx: TransactionClient, accountId: string, organizationId: string) {
    const membership = await requireOrganizationMembership(tx, accountId, organizationId).catch(
      () => {
        throw new AuthError("PARTNER_NOT_FOUND", "partner is unavailable");
      },
    );
    return { accountId, organizationId, role: membership.role as MembershipRole };
  }
  private access(actor: Awaited<ReturnType<PartnerService["actor"]>>, row: PartnerRow) {
    try {
      return this.policy.requireAccess(actor, {
        organizationId: row.organization_id,
        ownerAccountId: row.owner_account_id,
      });
    } catch (error) {
      if (error instanceof OwnedRecordUnavailableError)
        throw new AuthError("PARTNER_NOT_FOUND", "partner is unavailable");
      throw error;
    }
  }
  private async row(
    tx: TransactionClient,
    organizationId: string,
    partnerId: string,
    lock = false,
  ) {
    const rows = lock
      ? await tx<
          PartnerRow[]
        >`select * from partners where id = ${partnerId} and organization_id = ${organizationId} for update`
      : await tx<
          PartnerRow[]
        >`select * from partners where id = ${partnerId} and organization_id = ${organizationId}`;
    const row = rows[0];
    if (!row) throw new AuthError("PARTNER_NOT_FOUND", "partner is unavailable");
    return row;
  }
  private context(id: string, field: string) {
    return `partner:${id}:${field}`;
  }
  private encrypted(id: string, field: string, value?: string) {
    return value === undefined
      ? null
      : this.security.cipher.encrypt(value, this.context(id, field));
  }
  private decrypted(row: PartnerRow, field: "phone" | "wechat" | "email" | "address") {
    const envelope = row[`${field}_cipher`];
    return envelope === null
      ? null
      : this.security.cipher.decrypt(envelope, this.context(row.id, field));
  }
  private maskPhone(value: string | null) {
    return value === null
      ? null
      : `${value.slice(0, 3)} ${value.slice(3, 6)}****${value.slice(-4)}`;
  }
  private maskSimple(value: string | null) {
    return value === null ? null : value.length <= 2 ? "**" : `${value[0]}***${value.at(-1)}`;
  }
  private maskEmail(value: string | null) {
    if (value === null) return null;
    const [local, domain] = value.split("@");
    return `${local?.[0] ?? "*"}***@${domain ?? "***"}`;
  }
  private maskAddress(value: string | null) {
    return value === null ? null : `${value.slice(0, Math.min(3, value.length))}***`;
  }
  private summary(row: PartnerRow) {
    const phone = this.decrypted(row, "phone"),
      wechat = this.decrypted(row, "wechat"),
      email = this.decrypted(row, "email"),
      address = this.decrypted(row, "address");
    return {
      id: row.id,
      organizationId: row.organization_id,
      ownerAccountId: row.owner_account_id,
      createdByAccountId: row.created_by_account_id,
      name: row.name,
      organizationName: row.organization_name,
      department: row.department,
      jobTitle: row.job_title,
      phoneMasked: this.maskPhone(phone),
      wechatMasked: this.maskSimple(wechat),
      emailMasked: this.maskEmail(email),
      addressMasked: this.maskAddress(address),
      cooperationStage: row.cooperation_stage,
      tags: row.tags,
      notes: row.notes,
      lastContactAt: row.last_contact_at?.toISOString() ?? null,
      nextFollowUpAt: row.next_follow_up_at?.toISOString() ?? null,
      recordState: row.record_state,
      version: row.version,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    };
  }
  private detail(row: PartnerRow) {
    return {
      ...this.summary(row),
      phone: this.decrypted(row, "phone"),
      wechat: this.decrypted(row, "wechat"),
      email: this.decrypted(row, "email"),
      address: this.decrypted(row, "address"),
    };
  }

  public async create(
    tx: TransactionClient,
    accountId: string,
    organizationId: string,
    raw: unknown,
  ) {
    const input = PartnerCreateRequest.parse(raw);
    await this.actor(tx, accountId, organizationId);
    const id = randomUUID();
    const phone = this.encrypted(id, "phone", input.phone),
      wechat = this.encrypted(id, "wechat", input.wechat),
      email = this.encrypted(id, "email", input.email),
      address = this.encrypted(id, "address", input.address);
    const [row] = await tx<
      PartnerRow[]
    >`insert into partners (id, organization_id, owner_account_id, created_by_account_id, name, organization_name, department, job_title, address_cipher, phone_cipher, wechat_cipher, email_cipher, phone_blind_index, wechat_blind_index, email_blind_index, cooperation_stage, tags, notes, last_contact_at, next_follow_up_at) values (${id}, ${organizationId}, ${accountId}, ${accountId}, ${input.name}, ${input.organizationName ?? null}, ${input.department ?? null}, ${input.jobTitle ?? null}, ${address ? tx.json(address as unknown as JSONValue) : null}, ${phone ? tx.json(phone as unknown as JSONValue) : null}, ${wechat ? tx.json(wechat as unknown as JSONValue) : null}, ${email ? tx.json(email as unknown as JSONValue) : null}, ${input.phone ? this.security.blindIndex.phone(input.phone) : null}, ${input.wechat ? this.security.blindIndex.wechat(input.wechat) : null}, ${input.email ? this.security.blindIndex.email(input.email) : null}, ${input.cooperationStage}, ${input.tags}, ${input.notes ?? null}, ${input.lastContactAt ?? null}, ${input.nextFollowUpAt ?? null}) returning *`;
    if (!row) throw new Error("partner insert failed");
    const ref = { organizationId, resourceType: "partner" as const, resourceId: id };
    await this.collaboration.registerResource(tx, ref);
    await this.collaboration.appendDomainEvent(tx, {
      accountId,
      aggregate: ref,
      sequence: 1,
      eventType: "partner.created",
      schemaVersion: 1,
      payload: { ownerAccountId: accountId, cooperationStage: input.cooperationStage },
    });
    return this.detail(row);
  }

  public async list(
    tx: TransactionClient,
    accountId: string,
    organizationId: string,
    raw: unknown,
  ) {
    const input = PartnerListQuery.parse(raw),
      actor = await this.actor(tx, accountId, organizationId);
    const admin = actor.role === "org_owner" || actor.role === "org_admin";
    if (input.owner === "all" && !admin)
      throw new AuthError("PARTNER_NOT_FOUND", "partner is unavailable");
    const owner = input.owner === "all" ? (input.ownerAccountId ?? null) : accountId;
    const state = input.recordState ?? null;
    const stage = input.cooperationStage ?? null;
    const rows = await tx<
      PartnerRow[]
    >`select * from partners where organization_id = ${organizationId} and (${owner}::uuid is null or owner_account_id = ${owner}) and (${state}::text is null or record_state = ${state}) and (${stage}::text is null or cooperation_stage = ${stage}) order by next_follow_up_at nulls last, updated_at desc, id limit ${input.limit}`;
    return rows.map((row) => this.summary(row));
  }
  public async read(
    tx: TransactionClient,
    accountId: string,
    organizationId: string,
    partnerId: string,
  ) {
    const actor = await this.actor(tx, accountId, organizationId),
      row = await this.row(tx, organizationId, partnerId);
    this.access(actor, row);
    return this.detail(row);
  }

  public async update(
    tx: TransactionClient,
    accountId: string,
    organizationId: string,
    partnerId: string,
    raw: unknown,
  ) {
    const input = PartnerUpdateRequest.parse(raw),
      actor = await this.actor(tx, accountId, organizationId),
      current = await this.row(tx, organizationId, partnerId, true);
    this.access(actor, current);
    if (current.version !== input.expectedVersion) this.conflict();
    if (current.record_state !== "active")
      throw new AuthError("PARTNER_FORBIDDEN", "archived partner is read-only");
    const phoneCipher =
      input.phone === undefined
        ? current.phone_cipher
        : this.encrypted(partnerId, "phone", input.phone);
    const wechatCipher =
      input.wechat === undefined
        ? current.wechat_cipher
        : this.encrypted(partnerId, "wechat", input.wechat);
    const emailCipher =
      input.email === undefined
        ? current.email_cipher
        : this.encrypted(partnerId, "email", input.email);
    const addressCipher =
      input.address === undefined
        ? current.address_cipher
        : this.encrypted(partnerId, "address", input.address);
    const [row] = await tx<
      PartnerRow[]
    >`update partners set name = ${input.name ?? current.name}, organization_name = ${input.organizationName ?? current.organization_name}, department = ${input.department ?? current.department}, job_title = ${input.jobTitle ?? current.job_title}, phone_cipher = ${phoneCipher ? tx.json(phoneCipher as unknown as JSONValue) : null}, wechat_cipher = ${wechatCipher ? tx.json(wechatCipher as unknown as JSONValue) : null}, email_cipher = ${emailCipher ? tx.json(emailCipher as unknown as JSONValue) : null}, address_cipher = ${addressCipher ? tx.json(addressCipher as unknown as JSONValue) : null}, phone_blind_index = ${input.phone === undefined ? current.phone_blind_index : this.security.blindIndex.phone(input.phone)}, wechat_blind_index = ${input.wechat === undefined ? current.wechat_blind_index : this.security.blindIndex.wechat(input.wechat)}, email_blind_index = ${input.email === undefined ? current.email_blind_index : this.security.blindIndex.email(input.email)}, cooperation_stage = ${input.cooperationStage ?? current.cooperation_stage}, tags = ${input.tags ?? current.tags}, notes = ${input.notes ?? current.notes}, last_contact_at = ${input.lastContactAt ?? current.last_contact_at}, next_follow_up_at = ${input.nextFollowUpAt ?? current.next_follow_up_at}, version = version + 1, updated_at = now() where id = ${partnerId} returning *`;
    if (!row) throw new Error("partner update failed");
    await this.event(tx, accountId, row, "partner.updated", {});
    return this.detail(row);
  }
  public archive(
    tx: TransactionClient,
    accountId: string,
    organizationId: string,
    partnerId: string,
    raw: unknown,
  ) {
    return this.changeState(
      tx,
      accountId,
      organizationId,
      partnerId,
      raw,
      "archived",
      "partner.archived",
    );
  }
  public restore(
    tx: TransactionClient,
    accountId: string,
    organizationId: string,
    partnerId: string,
    raw: unknown,
  ) {
    return this.changeState(
      tx,
      accountId,
      organizationId,
      partnerId,
      raw,
      "active",
      "partner.restored",
    );
  }
  private async changeState(
    tx: TransactionClient,
    accountId: string,
    organizationId: string,
    partnerId: string,
    raw: unknown,
    state: "active" | "archived",
    eventType: string,
  ) {
    const input = PartnerVersionRequest.parse(raw),
      actor = await this.actor(tx, accountId, organizationId),
      current = await this.row(tx, organizationId, partnerId, true);
    this.access(actor, current);
    if (current.version !== input.expectedVersion) this.conflict();
    const [row] = await tx<
      PartnerRow[]
    >`update partners set record_state = ${state}, version = version + 1, updated_at = now() where id = ${partnerId} returning *`;
    if (!row) throw new Error("partner state update failed");
    await this.event(tx, accountId, row, eventType, {});
    return this.detail(row);
  }
  public async transfer(
    tx: TransactionClient,
    accountId: string,
    organizationId: string,
    partnerId: string,
    raw: unknown,
  ) {
    const input = PartnerTransferRequest.parse(raw),
      actor = await this.actor(tx, accountId, organizationId),
      current = await this.row(tx, organizationId, partnerId, true);
    this.access(actor, current);
    if (current.version !== input.expectedVersion) this.conflict();
    try {
      await requireOrganizationMembership(tx, input.accountId, organizationId);
    } catch {
      throw new AuthError("PARTNER_FORBIDDEN", "target owner is unavailable");
    }
    const [row] = await tx<
      PartnerRow[]
    >`update partners set owner_account_id = ${input.accountId}, record_state = 'active', version = version + 1, updated_at = now() where id = ${partnerId} returning *`;
    if (!row) throw new Error("partner transfer failed");
    await this.event(tx, accountId, row, "partner.owner_transferred", {
      ownerAccountId: input.accountId,
    });
    return this.detail(row);
  }
  public async reconcileRemovedOwners(tx: TransactionClient, organizationId: string) {
    const rows = await tx<
      { id: string }[]
    >`update partners partner set record_state = 'awaiting_owner', version = version + 1, updated_at = now() where organization_id = ${organizationId} and record_state <> 'awaiting_owner' and not exists (select 1 from memberships where organization_id = partner.organization_id and account_id = partner.owner_account_id and status = 'active') returning id`;
    return rows.length;
  }
  private async requireAdmin(tx: TransactionClient, accountId: string, organizationId: string) {
    try {
      await requireOrganizationMembership(tx, accountId, organizationId, [
        "org_owner",
        "org_admin",
      ]);
    } catch {
      throw new AuthError("PARTNER_NOT_FOUND", "partner is unavailable");
    }
  }
  public async bulkTransfer(
    tx: TransactionClient,
    accountId: string,
    organizationId: string,
    raw: unknown,
  ) {
    const input = PartnerBulkTransferRequest.parse(raw);
    await this.requireAdmin(tx, accountId, organizationId);
    let updated = 0;
    for (const item of input.items) {
      await this.transfer(tx, accountId, organizationId, item.partnerId, {
        accountId: input.accountId,
        expectedVersion: item.expectedVersion,
      });
      updated += 1;
    }
    return { updated };
  }
  public async duplicateCandidates(
    tx: TransactionClient,
    accountId: string,
    organizationId: string,
  ) {
    await this.requireAdmin(tx, accountId, organizationId);
    const groups: Array<{ field: "phone" | "wechat" | "email"; partnerIds: string[] }> = [];
    for (const [field, column] of [
      ["phone", "phone_blind_index"],
      ["wechat", "wechat_blind_index"],
      ["email", "email_blind_index"],
    ] as const) {
      const rows = await tx.unsafe<{ partner_ids: string[] }[]>(
        `select array_agg(id order by id) partner_ids from partners where organization_id = $1 and ${column} is not null group by ${column} having count(*) > 1`,
        [organizationId],
      );
      for (const row of rows) groups.push({ field, partnerIds: row.partner_ids });
    }
    return { groups };
  }
  public async exportAll(tx: TransactionClient, accountId: string, organizationId: string) {
    await this.requireAdmin(tx, accountId, organizationId);
    const rows = await tx<
      PartnerRow[]
    >`select * from partners where organization_id = ${organizationId} order by name,id`;
    const quote = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
    const lines = ["name,organization,department,title,phone,wechat,email,address,stage,owner"];
    for (const row of rows) {
      const item = this.detail(row);
      lines.push(
        [
          item.name,
          item.organizationName,
          item.department,
          item.jobTitle,
          item.phone,
          item.wechat,
          item.email,
          item.address,
          item.cooperationStage,
          item.ownerAccountId,
        ]
          .map(quote)
          .join(","),
      );
    }
    return { count: rows.length, content: `${lines.join("\n")}\n` };
  }
  private async event(
    tx: TransactionClient,
    accountId: string,
    row: PartnerRow,
    eventType: string,
    payload: Record<string, JSONValue>,
  ) {
    await this.collaboration.appendDomainEvent(tx, {
      accountId,
      aggregate: {
        organizationId: row.organization_id,
        resourceType: "partner",
        resourceId: row.id,
      },
      sequence: row.version,
      eventType,
      schemaVersion: 1,
      payload,
    });
  }
  private conflict(): never {
    throw new AuthError("PARTNER_VERSION_CONFLICT", "partner changed");
  }
}
