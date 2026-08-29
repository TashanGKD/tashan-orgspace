import { z } from "zod";

import { AccountId, IsoDateTime } from "./common.js";

export const WorkItemType = z.enum(["task", "meeting", "approval", "change_request"]);
export const WorkItemStatus = z.enum(["open", "completed", "cancelled"]);
export const WorkPriority = z.enum(["normal", "urgent"]);
export const AssignmentStatus = z.enum(["assigned", "disputed", "transfer_pending"]);

export const WorkItemCreateRequest = z
  .object({
    type: WorkItemType,
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().max(20_000).default(""),
    priority: WorkPriority.default("normal"),
    dueAt: IsoDateTime.optional(),
    meetingStartsAt: IsoDateTime.optional(),
    assigneeAccountIds: z.array(AccountId).max(100).default([]),
  })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.assigneeAccountIds).size !== value.assigneeAccountIds.length) {
      context.addIssue({ code: "custom", message: "duplicate assignee" });
    }
    if (value.type === "meeting" && value.meetingStartsAt === undefined) {
      context.addIssue({ code: "custom", message: "meeting start time is required" });
    }
  });

const Version = z.number().int().min(1);
const Reason = z.string().trim().min(1).max(2_000);
export const WorkItemTransitionRequest = z.discriminatedUnion("action", [
  z
    .object({ action: z.literal("assign"), accountId: AccountId, expectedVersion: Version })
    .strict(),
  z
    .object({
      action: z.literal("dispute"),
      assignmentId: z.uuid(),
      reason: Reason,
      expectedVersion: Version,
    })
    .strict(),
  z
    .object({
      action: z.literal("request_transfer"),
      assignmentId: z.uuid(),
      targetAccountId: AccountId,
      reason: Reason,
      expectedVersion: Version,
    })
    .strict(),
  z
    .object({
      action: z.literal("approve_transfer"),
      assignmentId: z.uuid(),
      expectedVersion: Version,
    })
    .strict(),
  z.object({ action: z.literal("complete"), expectedVersion: Version }).strict(),
  z.object({ action: z.literal("reopen"), expectedVersion: Version }).strict(),
  z.object({ action: z.literal("cancel"), expectedVersion: Version }).strict(),
]);
