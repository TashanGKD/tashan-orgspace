import { z } from "zod";
import { AccountId, IsoDateTime, OrganizationId, PhoneNumber } from "./common.js";

export const PartnerCooperationStage = z.enum(["lead", "contacting", "active", "paused", "ended"]);
export const PartnerRecordState = z.enum(["active", "archived", "awaiting_owner"]);
const ContactFields = {
  organizationName: z.string().trim().max(200).optional(),
  department: z.string().trim().max(200).optional(),
  jobTitle: z.string().trim().max(200).optional(),
  address: z.string().trim().max(1000).optional(),
  phone: PhoneNumber.optional(),
  wechat: z.string().trim().min(1).max(200).optional(),
  email: z.email().max(320).optional(),
  cooperationStage: PartnerCooperationStage,
  tags: z.array(z.string().trim().min(1).max(100)).max(100).default([]),
  notes: z.string().trim().max(20000).optional(),
  lastContactAt: IsoDateTime.optional(),
  nextFollowUpAt: IsoDateTime.optional(),
};
export const PartnerCreateRequest = z
  .object({ name: z.string().trim().min(1).max(200), ...ContactFields })
  .strict();
export const PartnerUpdateRequest = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    organizationName: ContactFields.organizationName,
    department: ContactFields.department,
    jobTitle: ContactFields.jobTitle,
    address: ContactFields.address,
    phone: ContactFields.phone,
    wechat: ContactFields.wechat,
    email: ContactFields.email,
    cooperationStage: PartnerCooperationStage.optional(),
    tags: ContactFields.tags.optional(),
    notes: ContactFields.notes,
    lastContactAt: ContactFields.lastContactAt,
    nextFollowUpAt: ContactFields.nextFollowUpAt,
    expectedVersion: z.number().int().min(1),
  })
  .strict();
export const PartnerListQuery = z
  .object({
    owner: z.enum(["self", "all"]).default("self"),
    ownerAccountId: AccountId.optional(),
    recordState: PartnerRecordState.optional(),
    cooperationStage: PartnerCooperationStage.optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict();
export const PartnerVersionRequest = z
  .object({ expectedVersion: z.number().int().min(1) })
  .strict();
export const PartnerTransferRequest = z
  .object({ accountId: AccountId, expectedVersion: z.number().int().min(1) })
  .strict();
export const PartnerBulkTransferRequest = z
  .object({
    accountId: AccountId,
    items: z
      .array(z.object({ partnerId: z.uuid(), expectedVersion: z.number().int().min(1) }).strict())
      .min(1)
      .max(500),
  })
  .strict();
export const PartnerLinkRequest = z.discriminatedUnion("type", [
  z.object({ type: z.literal("file"), spaceId: z.uuid(), entryId: z.uuid() }).strict(),
  z.object({ type: z.enum(["task", "meeting"]), workItemId: z.uuid() }).strict(),
]);
export const PartnerExportRequest = z
  .object({ owner: z.literal("all"), format: z.literal("csv").default("csv") })
  .strict();

export const PartnerSummary = z
  .object({
    id: z.uuid(),
    organizationId: OrganizationId,
    ownerAccountId: AccountId,
    createdByAccountId: AccountId,
    name: z.string(),
    organizationName: z.string().nullable(),
    department: z.string().nullable(),
    jobTitle: z.string().nullable(),
    phoneMasked: z.string().nullable(),
    wechatMasked: z.string().nullable(),
    emailMasked: z.string().nullable(),
    addressMasked: z.string().nullable(),
    cooperationStage: PartnerCooperationStage,
    tags: z.array(z.string()),
    notes: z.string().nullable(),
    lastContactAt: IsoDateTime.nullable(),
    nextFollowUpAt: IsoDateTime.nullable(),
    recordState: PartnerRecordState,
    version: z.number().int().min(1),
    createdAt: IsoDateTime,
    updatedAt: IsoDateTime,
  })
  .strict();
export const PartnerDetail = PartnerSummary.extend({
  phone: PhoneNumber.nullable(),
  wechat: z.string().nullable(),
  email: z.string().nullable(),
  address: z.string().nullable(),
}).strict();
export const PartnerListResponse = z
  .object({ items: z.array(PartnerSummary), nextCursor: z.null() })
  .strict();
export const PartnerReadResponse = z.object({ partner: PartnerDetail }).strict();
export const PartnerInteractionChannel = z.enum([
  "phone",
  "wechat",
  "email",
  "in_person",
  "meeting",
  "other",
]);
export const PartnerInteractionAddRequest = z
  .object({
    contactedAt: IsoDateTime,
    channel: PartnerInteractionChannel,
    summary: z.string().trim().min(1).max(20000),
    requiresFollowUp: z.boolean().default(false),
    nextFollowUpAt: IsoDateTime.optional(),
    correctsInteractionId: z.uuid().optional(),
    followUp: z
      .object({
        type: z.enum(["task", "meeting"]),
        title: z.string().trim().min(1).max(200),
        dueAt: IsoDateTime.optional(),
        meetingStartsAt: IsoDateTime.optional(),
      })
      .strict()
      .optional(),
    links: z
      .array(
        z.discriminatedUnion("type", [
          z.object({ type: z.literal("file"), spaceId: z.uuid(), entryId: z.uuid() }).strict(),
          z.object({ type: z.enum(["task", "meeting"]), workItemId: z.uuid() }).strict(),
        ]),
      )
      .max(100)
      .default([]),
  })
  .strict();
export const PartnerInteractionSummary = z
  .object({
    id: z.uuid(),
    partnerId: z.uuid(),
    organizationId: OrganizationId,
    contactedAt: IsoDateTime,
    channel: PartnerInteractionChannel,
    summary: z.string(),
    recordedByAccountId: AccountId,
    requiresFollowUp: z.boolean(),
    nextFollowUpAt: IsoDateTime.nullable(),
    correctsInteractionId: z.uuid().nullable(),
    followUpWorkItemId: z.uuid().nullable(),
    createdAt: IsoDateTime,
  })
  .strict();
export const PartnerInteractionListResponse = z
  .object({ items: z.array(PartnerInteractionSummary) })
  .strict();
export const PartnerInteractionReadResponse = z
  .object({ interaction: PartnerInteractionSummary })
  .strict();
export const PartnerLinkResponse = z.object({ linkId: z.uuid(), reverseLinkId: z.uuid() }).strict();
export const PartnerUnlinkResponse = z.object({ removed: z.literal(true) }).strict();
export const PartnerBulkTransferResponse = z.object({ updated: z.number().int().min(0) }).strict();
export const PartnerDuplicateListResponse = z
  .object({
    groups: z.array(
      z
        .object({
          field: z.enum(["phone", "wechat", "email"]),
          partnerIds: z.array(z.uuid()).min(2),
        })
        .strict(),
    ),
  })
  .strict();
export const PartnerExportResponse = z
  .object({ count: z.number().int().min(0), content: z.string() })
  .strict();
