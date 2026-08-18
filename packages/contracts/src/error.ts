import { z } from "zod";

import { RequestId } from "./common.js";

export const ErrorCode = z.enum([
  "AUTH_REQUIRED",
  "AUTH_INVALID_CREDENTIALS",
  "AUTH_TOKEN_EXPIRED",
  "AUTH_TOKEN_REVOKED",
  "DEVICE_REVOKED",
  "PHONE_NOT_VERIFIED",
  "ORG_FORBIDDEN",
  "ORG_NOT_FOUND",
  "CAPABILITY_NOT_FOUND",
  "IDEMPOTENCY_CONFLICT",
  "RATE_LIMITED",
  "USERNAME_TAKEN",
  "PHONE_PROVIDER_UNAVAILABLE",
  "VALIDATION_FAILED",
  "INTERNAL_ERROR",
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const ErrorEnvelope = z
  .object({
    error: z
      .object({
        code: ErrorCode,
        message: z.string().min(1),
        requestId: RequestId,
        details: z.record(z.string(), z.unknown()).optional(),
      })
      .strict(),
  })
  .strict();
export type ErrorEnvelope = z.infer<typeof ErrorEnvelope>;
