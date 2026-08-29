import { z } from "zod";
import { AccountId, IsoDateTime, NotificationId, OrganizationId } from "./common.js";

export const NotificationEventType = z.enum([
  "approval_requested",
  "emergency",
  "ordinary_task",
  "deadline_one_hour",
  "meeting_one_hour",
  "daily_summary",
  "partner_follow_up",
]);
export const NotificationPreferenceUpdateRequest = z
  .object({ dailySummaryEnabled: z.boolean() })
  .strict();
export const NotificationStatus = z.enum(["unread", "read"]);
export const NotificationRecord = z
  .object({
    id: NotificationId,
    organizationId: OrganizationId,
    recipientAccountId: AccountId,
    eventType: NotificationEventType,
    title: z.string().min(1).max(240),
    body: z.string().min(1).max(4_000),
    resourceType: z.string().min(1).max(100).nullable(),
    resourceId: z.uuid().nullable(),
    status: NotificationStatus,
    createdAt: IsoDateTime,
    readAt: IsoDateTime.nullable(),
  })
  .strict();
export const NotificationListQuery = z
  .object({
    status: NotificationStatus.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();
export const NotificationListResponse = z
  .object({ items: z.array(NotificationRecord), nextCursor: z.string().min(1).nullable() })
  .strict();
export const NotificationReadResponse = NotificationRecord;
export const NotificationMarkReadResponse = NotificationRecord;
export const NotificationPreferenceResponse = z
  .object({
    organizationId: OrganizationId,
    accountId: AccountId,
    dailySummaryEnabled: z.boolean(),
  })
  .strict();
export const IanaTimezone = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
      return true;
    } catch {
      return false;
    }
  }, "invalid IANA timezone");
export const NotificationPolicyPublishRequest = z
  .object({ timezone: IanaTimezone, expectedVersion: z.number().int().min(1) })
  .strict();
export const NotificationRules = z
  .object({
    approval_requested: z.object({ sms: z.literal("immediate") }).strict(),
    emergency: z.object({ sms: z.literal("immediate") }).strict(),
    ordinary_task: z.object({ sms: z.literal("optional") }).strict(),
    deadline_one_hour: z.object({ sms: z.literal("mandatory") }).strict(),
    meeting_one_hour: z.object({ sms: z.literal("mandatory") }).strict(),
    daily_summary: z.object({ sms: z.literal("preference") }).strict(),
    partner_follow_up: z.object({ sms: z.literal("mandatory") }).strict(),
  })
  .strict();
export const NotificationPolicyResponse = z
  .object({
    id: z.uuid(),
    organizationId: OrganizationId,
    policyVersion: z.number().int().min(1),
    organizationVersion: z.number().int().min(1),
    timezone: IanaTimezone,
    rules: NotificationRules,
    publishedAt: IsoDateTime,
  })
  .strict();

export type NotificationRecord = z.infer<typeof NotificationRecord>;
export type NotificationListQuery = z.infer<typeof NotificationListQuery>;
export type NotificationPreferenceUpdateRequest = z.infer<
  typeof NotificationPreferenceUpdateRequest
>;
