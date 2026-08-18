import { z } from "zod";

export const AccountId = z.uuid().brand<"AccountId">();
export type AccountId = z.infer<typeof AccountId>;

export const PrincipalId = z.uuid().brand<"PrincipalId">();
export type PrincipalId = z.infer<typeof PrincipalId>;

export const OrganizationId = z.uuid().brand<"OrganizationId">();
export type OrganizationId = z.infer<typeof OrganizationId>;

export const MembershipId = z.uuid().brand<"MembershipId">();
export type MembershipId = z.infer<typeof MembershipId>;

export const DeviceId = z.uuid().brand<"DeviceId">();
export type DeviceId = z.infer<typeof DeviceId>;

export const SessionId = z.uuid().brand<"SessionId">();
export type SessionId = z.infer<typeof SessionId>;

export const AuditEventId = z.uuid().brand<"AuditEventId">();
export type AuditEventId = z.infer<typeof AuditEventId>;

export const PhoneVerificationChallengeId = z.uuid().brand<"PhoneVerificationChallengeId">();
export type PhoneVerificationChallengeId = z.infer<typeof PhoneVerificationChallengeId>;

export const RequestId = z.uuid().brand<"RequestId">();
export type RequestId = z.infer<typeof RequestId>;

export const IsoDateTime = z.iso.datetime({ offset: true });
export type IsoDateTime = z.infer<typeof IsoDateTime>;

export const PrincipalType = z.enum(["human", "system", "ai_employee", "service_account"]);
export type PrincipalType = z.infer<typeof PrincipalType>;

export const Phase0CreatablePrincipalType = z.enum(["human", "system"]);
export type Phase0CreatablePrincipalType = z.infer<typeof Phase0CreatablePrincipalType>;

export const OrganizationRole = z.enum([
  "platform_superadmin",
  "platform_operator",
  "org_owner",
  "org_admin",
  "member",
]);
export type OrganizationRole = z.infer<typeof OrganizationRole>;

export const OrganizationMembershipRole = z.enum(["org_owner", "org_admin", "member"]);
export type OrganizationMembershipRole = z.infer<typeof OrganizationMembershipRole>;

export const ActorSource = z.enum(["web", "cli", "ai_via_cli", "system"]);
export type ActorSource = z.infer<typeof ActorSource>;

export const ClientChannel = z.enum(["web", "cli"]);
export type ClientChannel = z.infer<typeof ClientChannel>;

export const PhoneNumber = z.string().regex(/^\+[1-9]\d{7,14}$/, "phone must use E.164 format");
export type PhoneNumber = z.infer<typeof PhoneNumber>;

export const Username = z
  .string()
  .trim()
  .min(3)
  .max(64)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, "username contains unsupported characters");
export type Username = z.infer<typeof Username>;

export const Password = z
  .string()
  .min(12)
  .max(256)
  .regex(/[a-z]/, "password must contain a lowercase letter")
  .regex(/[A-Z]/, "password must contain an uppercase letter")
  .regex(/[0-9]/, "password must contain a number");
export type Password = z.infer<typeof Password>;
