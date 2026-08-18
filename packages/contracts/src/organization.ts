import { z } from "zod";

import {
  AccountId,
  IsoDateTime,
  MembershipId,
  OrganizationId,
  OrganizationMembershipRole,
  Username,
} from "./common.js";

export const OrganizationStatus = z.enum(["active", "suspended", "closed"]);
export type OrganizationStatus = z.infer<typeof OrganizationStatus>;

export const MembershipStatus = z.enum(["active", "suspended", "removed"]);
export type MembershipStatus = z.infer<typeof MembershipStatus>;

export const OrganizationSummary = z
  .object({
    id: OrganizationId,
    name: z.string().trim().min(1).max(128),
    status: OrganizationStatus,
    storageQuotaBytes: z.number().int().nonnegative(),
    createdAt: IsoDateTime,
  })
  .strict();
export type OrganizationSummary = z.infer<typeof OrganizationSummary>;

export const MembershipSummary = z
  .object({
    id: MembershipId,
    organizationId: OrganizationId,
    accountId: AccountId,
    username: Username,
    role: OrganizationMembershipRole,
    status: MembershipStatus,
    createdAt: IsoDateTime,
    updatedAt: IsoDateTime,
  })
  .strict();
export type MembershipSummary = z.infer<typeof MembershipSummary>;

export const OrganizationListResponse = z.object({ items: z.array(OrganizationSummary) }).strict();
export type OrganizationListResponse = z.infer<typeof OrganizationListResponse>;

export const OrganizationCreateRequest = z
  .object({ name: z.string().trim().min(1).max(128) })
  .strict();
export type OrganizationCreateRequest = z.infer<typeof OrganizationCreateRequest>;

export const OrganizationCreateResponse = z
  .object({
    organization: OrganizationSummary,
    membership: MembershipSummary,
  })
  .strict();
export type OrganizationCreateResponse = z.infer<typeof OrganizationCreateResponse>;

export const OrganizationMemberListResponse = z
  .object({ items: z.array(MembershipSummary) })
  .strict();
export type OrganizationMemberListResponse = z.infer<typeof OrganizationMemberListResponse>;

export const OrganizationMemberAddRequest = z
  .object({
    accountId: AccountId,
    role: OrganizationMembershipRole,
  })
  .strict();
export type OrganizationMemberAddRequest = z.infer<typeof OrganizationMemberAddRequest>;

export const OrganizationMemberAddResponse = z.object({ membership: MembershipSummary }).strict();
export type OrganizationMemberAddResponse = z.infer<typeof OrganizationMemberAddResponse>;
