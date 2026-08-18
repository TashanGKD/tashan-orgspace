import { z } from "zod";

import {
  AccountId,
  ClientChannel,
  DeviceId,
  IsoDateTime,
  Password,
  PhoneNumber,
  PhoneVerificationChallengeId,
  PrincipalId,
  PrincipalType,
  SessionId,
  Username,
} from "./common.js";

export const AccountStatus = z.enum(["active", "suspended"]);
export type AccountStatus = z.infer<typeof AccountStatus>;

export const AccountSummary = z
  .object({
    id: AccountId,
    username: Username,
    phone: PhoneNumber.nullable(),
    phoneVerifiedAt: IsoDateTime.nullable(),
    status: AccountStatus,
    createdAt: IsoDateTime,
  })
  .strict();
export type AccountSummary = z.infer<typeof AccountSummary>;

export const PrincipalSummary = z
  .object({
    id: PrincipalId,
    type: PrincipalType,
    accountId: AccountId.nullable(),
  })
  .strict();
export type PrincipalSummary = z.infer<typeof PrincipalSummary>;

export const DeviceLoginMetadata = z
  .object({
    id: DeviceId,
    name: z.string().trim().min(1).max(128),
    os: z.string().trim().min(1).max(64),
    architecture: z.string().trim().min(1).max(64),
    clientVersion: z.string().trim().min(1).max(64),
    channel: ClientChannel,
  })
  .strict();
export type DeviceLoginMetadata = z.infer<typeof DeviceLoginMetadata>;

export const RegisterRequest = z
  .object({
    username: Username,
    password: Password,
  })
  .strict();
export type RegisterRequest = z.infer<typeof RegisterRequest>;

export const RegisterResponse = z
  .object({
    account: AccountSummary,
    principal: PrincipalSummary,
  })
  .strict();
export type RegisterResponse = z.infer<typeof RegisterResponse>;

export const PhoneVerificationStartRequest = z.object({ phone: PhoneNumber }).strict();
export type PhoneVerificationStartRequest = z.infer<typeof PhoneVerificationStartRequest>;

export const PhoneVerificationStartResponse = z
  .object({
    challengeId: PhoneVerificationChallengeId,
    expiresAt: IsoDateTime,
  })
  .strict();
export type PhoneVerificationStartResponse = z.infer<typeof PhoneVerificationStartResponse>;

export const PhoneVerificationConfirmRequest = z
  .object({
    challengeId: PhoneVerificationChallengeId,
    code: z.string().regex(/^\d{6}$/, "verification code must contain six digits"),
  })
  .strict();
export type PhoneVerificationConfirmRequest = z.infer<typeof PhoneVerificationConfirmRequest>;

export const PhoneVerificationConfirmResponse = z
  .object({
    phone: PhoneNumber,
    verifiedAt: IsoDateTime,
  })
  .strict();
export type PhoneVerificationConfirmResponse = z.infer<typeof PhoneVerificationConfirmResponse>;

export const LoginRequest = z
  .object({
    username: Username,
    password: z.string().min(1).max(256),
    device: DeviceLoginMetadata,
  })
  .strict();
export type LoginRequest = z.infer<typeof LoginRequest>;

export const SessionTokens = z
  .object({
    tokenType: z.literal("Bearer"),
    accessToken: z.string().min(1),
    accessTokenExpiresAt: IsoDateTime,
    refreshToken: z.string().min(32),
    refreshTokenExpiresAt: IsoDateTime,
  })
  .strict();
export type SessionTokens = z.infer<typeof SessionTokens>;

export const LoginResponse = z
  .object({
    account: AccountSummary,
    principal: PrincipalSummary,
    sessionId: SessionId,
    deviceId: DeviceId,
    tokens: SessionTokens,
  })
  .strict();
export type LoginResponse = z.infer<typeof LoginResponse>;

export const RefreshRequest = z.object({ refreshToken: z.string().min(32).optional() }).strict();
export type RefreshRequest = z.infer<typeof RefreshRequest>;

export const RefreshResponse = z
  .object({
    sessionId: SessionId,
    deviceId: DeviceId,
    tokens: SessionTokens,
  })
  .strict();
export type RefreshResponse = z.infer<typeof RefreshResponse>;

export const LogoutRequest = z.object({ refreshToken: z.string().min(32).optional() }).strict();
export type LogoutRequest = z.infer<typeof LogoutRequest>;

export const LogoutResponse = z.object({ loggedOut: z.literal(true) }).strict();
export type LogoutResponse = z.infer<typeof LogoutResponse>;

export const WhoAmIResponse = z
  .object({
    account: AccountSummary,
    principal: PrincipalSummary,
    sessionId: SessionId,
    deviceId: DeviceId,
  })
  .strict();
export type WhoAmIResponse = z.infer<typeof WhoAmIResponse>;

export const DeviceSummary = z
  .object({
    id: DeviceId,
    name: z.string().min(1),
    os: z.string().min(1),
    architecture: z.string().min(1),
    clientVersion: z.string().min(1),
    firstSeenAt: IsoDateTime,
    lastSeenAt: IsoDateTime,
    current: z.boolean(),
    revokedAt: IsoDateTime.nullable(),
  })
  .strict();
export type DeviceSummary = z.infer<typeof DeviceSummary>;

export const DeviceListResponse = z.object({ items: z.array(DeviceSummary) }).strict();
export type DeviceListResponse = z.infer<typeof DeviceListResponse>;

export const DeviceRevokeResponse = z
  .object({
    deviceId: DeviceId,
    revokedAt: IsoDateTime,
  })
  .strict();
export type DeviceRevokeResponse = z.infer<typeof DeviceRevokeResponse>;
