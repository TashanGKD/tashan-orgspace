import { z } from "zod";

import { AccountId, IsoDateTime, OrganizationId, SafeByteCount, SpaceId } from "./common.js";

export const SpaceType = z.enum(["personal", "organization"]);
export type SpaceType = z.infer<typeof SpaceType>;

export const SpaceWriteState = z.enum(["writable", "quota_readonly"]);
export type SpaceWriteState = z.infer<typeof SpaceWriteState>;

export const SpaceSummary = z
  .object({
    id: SpaceId,
    type: SpaceType,
    accountId: AccountId.nullable(),
    organizationId: OrganizationId.nullable(),
    rootFolderId: z.uuid(),
    quotaBytes: SafeByteCount,
    usedBytes: SafeByteCount,
    reservedBytes: SafeByteCount,
    writeState: SpaceWriteState,
    createdAt: IsoDateTime,
    updatedAt: IsoDateTime,
  })
  .strict()
  .refine(
    (space) =>
      (space.type === "personal" && space.accountId !== null && space.organizationId === null) ||
      (space.type === "organization" && space.organizationId !== null && space.accountId === null),
    { message: "space owner must match space type" },
  );
export type SpaceSummary = z.infer<typeof SpaceSummary>;

export const SpaceIdPath = z.object({ spaceId: SpaceId }).strict();
export const SpaceListResponse = z.object({ items: z.array(SpaceSummary) }).strict();
export const SpaceReadResponse = z.object({ space: SpaceSummary }).strict();
export const SpaceUsageResponse = z
  .object({
    spaceId: SpaceId,
    quotaBytes: SafeByteCount,
    usedBytes: SafeByteCount,
    reservedBytes: SafeByteCount,
    availableBytes: SafeByteCount,
    writeState: SpaceWriteState,
  })
  .strict();

export const PersonalQuotaSetRequest = z.object({ quotaBytes: SafeByteCount }).strict();
export const PersonalQuotaSetResponse = z
  .object({ accountId: AccountId, organizationId: OrganizationId, space: SpaceSummary })
  .strict();
