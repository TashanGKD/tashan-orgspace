import { z } from "zod";
import { AccountId, IsoDateTime, OrganizationId } from "./common.js";

const NumericFormula = z
  .object({ type: z.literal("numeric"), start: z.number(), target: z.number() })
  .strict()
  .refine((value) => value.start !== value.target, { message: "numeric target must differ" });
const ManualFormula = z.object({ type: z.literal("manual") }).strict();
const LinkedTasksFormula = z
  .object({ type: z.literal("linked_tasks"), workItemIds: z.array(z.uuid()).min(1).max(200) })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.workItemIds).size !== value.workItemIds.length) {
      context.addIssue({ code: "custom", message: "duplicate linked task" });
    }
  });
export const KeyResultFormula = z.discriminatedUnion("type", [
  NumericFormula,
  ManualFormula,
  LinkedTasksFormula,
]);

export const ObjectiveCreateRequest = z
  .object({
    title: z.string().trim().min(1).max(200),
    cycle: z.string().trim().min(1).max(100),
    keyResults: z
      .array(
        z
          .object({
            title: z.string().trim().min(1).max(200),
            weight: z.number().int().min(1).max(100),
            formula: KeyResultFormula,
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict()
  .refine((value) => value.keyResults.reduce((sum, item) => sum + item.weight, 0) === 100, {
    message: "key result weights must total 100",
  });

export const OkrProgressUpdateRequest = z
  .object({ progress: z.number(), expectedVersion: z.number().int().min(1) })
  .strict();
const ObjectivePatch = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    cycle: z.string().trim().min(1).max(100).optional(),
  })
  .strict()
  .refine((value) => value.title !== undefined || value.cycle !== undefined, {
    message: "objective patch is empty",
  });
export const OkrChangeRequest = z
  .object({ patch: ObjectivePatch, expectedVersion: z.number().int().min(1) })
  .strict();
export const OkrChangeApprovalRequest = z
  .object({ expectedObjectiveVersion: z.number().int().min(1) })
  .strict();

export const ObjectiveSummary = z
  .object({
    id: z.uuid(),
    organizationId: OrganizationId,
    ownerAccountId: AccountId,
    title: z.string(),
    cycle: z.string(),
    progress: z.number().min(0).max(100),
    version: z.number().int().min(1),
    createdAt: IsoDateTime,
    updatedAt: IsoDateTime,
  })
  .strict();
export const KeyResultSummary = z
  .object({
    id: z.uuid(),
    objectiveId: z.uuid(),
    title: z.string(),
    weight: z.number().int(),
    formula: KeyResultFormula,
    formulaVersion: z.number().int().min(1),
    progress: z.number().min(0).max(100),
    version: z.number().int().min(1),
    createdAt: IsoDateTime,
    updatedAt: IsoDateTime,
  })
  .strict();
export const ObjectiveStateResponse = z
  .object({ objective: ObjectiveSummary, keyResults: z.array(KeyResultSummary) })
  .strict();
export const ObjectiveListQuery = z
  .object({
    cycle: z.string().optional(),
    ownerAccountId: AccountId.optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict();
export const ObjectiveListResponse = z
  .object({ items: z.array(ObjectiveSummary), nextCursor: z.null() })
  .strict();
export const KeyResultProgressResponse = z.object({ keyResult: KeyResultSummary }).strict();
export const OkrChangeRequestSummary = z
  .object({
    id: z.uuid(),
    objectiveId: z.uuid(),
    workItemId: z.uuid(),
    status: z.literal("pending"),
  })
  .strict();
export const ObjectiveMutationResponse = z.object({ objective: ObjectiveSummary }).strict();
export const OkrChangeRequestResponse = z
  .object({ changeRequest: OkrChangeRequestSummary, workItem: z.unknown() })
  .strict();
