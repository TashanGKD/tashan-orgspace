import { z } from "zod";

import { AccountId } from "./common.js";

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
