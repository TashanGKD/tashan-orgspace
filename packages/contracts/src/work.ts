import { z } from "zod";

import { AccountId, IsoDateTime, OrganizationId } from "./common.js";
import { ResourceRef } from "./collaboration.js";

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
    sendSms: z.boolean().default(false),
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

export const WorkItemSummary = z
  .object({
    id: z.uuid(),
    organizationId: OrganizationId,
    type: WorkItemType,
    title: z.string(),
    description: z.string(),
    priority: WorkPriority,
    status: WorkItemStatus,
    dueAt: IsoDateTime.nullable(),
    meetingStartsAt: IsoDateTime.nullable(),
    createdByAccountId: AccountId,
    version: z.number().int().min(1),
    createdAt: IsoDateTime,
    updatedAt: IsoDateTime,
  })
  .strict();
export const WorkAssignmentSummary = z
  .object({
    id: z.uuid(),
    assigneeAccountId: AccountId,
    assignedByAccountId: AccountId,
    status: AssignmentStatus,
    disputeReason: z.string().nullable(),
    transferTargetAccountId: AccountId.nullable(),
    transferReason: z.string().nullable(),
    createdAt: IsoDateTime,
    updatedAt: IsoDateTime,
  })
  .strict();
export const WorkItemStateResponse = z
  .object({ item: WorkItemSummary, assignments: z.array(WorkAssignmentSummary) })
  .strict();
export const WorkItemListQuery = z
  .object({
    type: WorkItemType.optional(),
    status: WorkItemStatus.optional(),
    assigneeAccountId: AccountId.optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict();
export const WorkItemListResponse = z
  .object({ items: z.array(WorkItemSummary), nextCursor: z.null() })
  .strict();

export const MyWorkKind = z.enum(["task", "meeting", "approval", "reminder", "mention"]);
export const MyWorkListQuery = z
  .object({
    kind: MyWorkKind.optional(),
    limit: z.coerce.number().int().min(1).max(200).default(100),
  })
  .strict();
export const MyWorkItem = z
  .object({
    id: z.string().min(1),
    kind: MyWorkKind,
    organizationId: OrganizationId,
    organizationName: z.string().min(1),
    title: z.string().min(1),
    status: z.string().min(1),
    dueAt: IsoDateTime.nullable(),
    href: z.string().startsWith("/"),
    resource: ResourceRef.nullable(),
    sortAt: IsoDateTime,
  })
  .strict();
export const MyWorkListResponse = z.object({ items: z.array(MyWorkItem) }).strict();
