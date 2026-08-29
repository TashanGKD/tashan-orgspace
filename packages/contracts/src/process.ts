import { z } from "zod";

import { AccountId, IsoDateTime, OrganizationId } from "./common.js";

export const ProcessApprovalMode = z.enum(["single", "sequence", "any", "all"]);
export const ProcessInstanceStatus = z.enum([
  "pending",
  "approved",
  "rejected",
  "returned",
  "withdrawn",
]);
export const ProcessStepStatus = z.enum([
  "waiting",
  "pending",
  "approved",
  "rejected",
  "returned",
  "skipped",
]);

const Approvers = z
  .array(AccountId)
  .min(1)
  .max(100)
  .superRefine((value, context) => {
    if (new Set(value).size !== value.length) {
      context.addIssue({ code: "custom", message: "duplicate approver" });
    }
  });

function validateMode(
  value: { mode: z.infer<typeof ProcessApprovalMode>; approverAccountIds: string[] },
  context: z.RefinementCtx,
) {
  if (value.mode === "single" && value.approverAccountIds.length !== 1) {
    context.addIssue({ code: "custom", message: "single approval requires one approver" });
  }
}

export const ProcessDefinitionCreateRequest = z
  .object({
    name: z.string().trim().min(1).max(200),
    mode: ProcessApprovalMode,
    approverAccountIds: Approvers,
  })
  .strict()
  .superRefine(validateMode);

export const ProcessVersionCreateRequest = z
  .object({
    mode: ProcessApprovalMode,
    approverAccountIds: Approvers,
    expectedDefinitionVersion: z.number().int().min(1),
  })
  .strict()
  .superRefine(validateMode);

export const ProcessStartRequest = z.object({ subject: z.record(z.string(), z.json()) }).strict();

const ExpectedVersion = z.number().int().min(1);
const Reason = z.string().trim().min(1).max(2_000);
export const ProcessDecisionRequest = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve"), expectedVersion: ExpectedVersion }).strict(),
  z
    .object({
      action: z.literal("reject"),
      reason: Reason.optional(),
      expectedVersion: ExpectedVersion,
    })
    .strict(),
  z
    .object({ action: z.literal("return"), reason: Reason, expectedVersion: ExpectedVersion })
    .strict(),
  z
    .object({ action: z.literal("withdraw"), reason: Reason, expectedVersion: ExpectedVersion })
    .strict(),
  z
    .object({
      action: z.literal("transfer"),
      targetAccountId: AccountId,
      reason: Reason,
      expectedVersion: ExpectedVersion,
    })
    .strict(),
]);

export const ProcessDefinitionSummary = z
  .object({
    id: z.uuid(),
    organizationId: OrganizationId,
    name: z.string(),
    createdByAccountId: AccountId,
    version: z.number().int().min(1),
    createdAt: IsoDateTime,
    updatedAt: IsoDateTime,
  })
  .strict();
export const ProcessVersionSummary = z
  .object({
    id: z.uuid(),
    definitionId: z.uuid(),
    versionNumber: z.number().int().min(1),
    mode: ProcessApprovalMode,
    status: z.enum(["draft", "published"]),
    publishedAt: IsoDateTime.nullable(),
    createdAt: IsoDateTime,
  })
  .strict();
export const ProcessDefinitionStateResponse = z
  .object({ definition: ProcessDefinitionSummary, version: ProcessVersionSummary })
  .strict();
export const ProcessInstanceSummary = z
  .object({
    id: z.uuid(),
    organizationId: OrganizationId,
    definitionVersionId: z.uuid(),
    initiatorAccountId: AccountId,
    subject: z.record(z.string(), z.json()),
    status: ProcessInstanceStatus,
    version: z.number().int().min(1),
    createdAt: IsoDateTime,
    updatedAt: IsoDateTime,
  })
  .strict();
export const ProcessInstanceStepSummary = z
  .object({
    id: z.uuid(),
    position: z.number().int().min(1),
    approverAccountId: AccountId,
    transferredFromAccountId: AccountId.nullable(),
    status: ProcessStepStatus,
    createdAt: IsoDateTime,
    updatedAt: IsoDateTime,
  })
  .strict();
export const ProcessInstanceStateResponse = z
  .object({ instance: ProcessInstanceSummary, steps: z.array(ProcessInstanceStepSummary) })
  .strict();
