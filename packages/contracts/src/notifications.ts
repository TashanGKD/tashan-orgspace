import { z } from "zod";

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
