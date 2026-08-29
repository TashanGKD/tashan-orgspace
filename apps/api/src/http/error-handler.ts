import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";

import { ErrorEnvelope, type ErrorCode } from "@tashan/contracts";

import { AuthError } from "../auth/auth-errors.js";
import { IdempotencyConflictError } from "../repositories/idempotency-repository.js";
import { requestContext } from "./request-context.js";

const ERROR_STATUS: Record<ErrorCode, number> = {
  AUTH_REQUIRED: 401,
  AUTH_INVALID_CREDENTIALS: 401,
  AUTH_TOKEN_EXPIRED: 401,
  AUTH_TOKEN_REVOKED: 401,
  DEVICE_REVOKED: 401,
  ACCOUNT_EXISTS: 409,
  VERIFICATION_INVALID: 400,
  VERIFICATION_EXPIRED: 400,
  VERIFICATION_RATE_LIMITED: 429,
  PASSWORD_RESET_FAILED: 400,
  ORG_FORBIDDEN: 403,
  ORG_NOT_FOUND: 404,
  CAPABILITY_NOT_FOUND: 404,
  IDEMPOTENCY_CONFLICT: 409,
  RATE_LIMITED: 429,
  PHONE_PROVIDER_UNAVAILABLE: 503,
  SPACE_NOT_FOUND: 404,
  SPACE_FORBIDDEN: 403,
  SPACE_READONLY: 409,
  QUOTA_EXCEEDED: 413,
  FILE_NOT_FOUND: 404,
  FILE_FORBIDDEN: 403,
  FILE_NAME_CONFLICT: 409,
  FILE_VERSION_CONFLICT: 409,
  UPLOAD_NOT_FOUND: 404,
  UPLOAD_EXPIRED: 410,
  UPLOAD_INCOMPLETE: 400,
  UPLOAD_CHECKSUM_MISMATCH: 400,
  FOLDER_MANAGER_REQUIRED: 403,
  FOLDER_LAST_MANAGER: 409,
  WORK_NOT_FOUND: 404,
  WORK_FORBIDDEN: 403,
  WORK_VERSION_CONFLICT: 409,
  WORK_TRANSITION_INVALID: 409,
  ASSIGNMENT_NOT_FOUND: 404,
  PROCESS_NOT_FOUND: 404,
  PROCESS_FORBIDDEN: 403,
  PROCESS_VERSION_CONFLICT: 409,
  PROCESS_TRANSITION_INVALID: 409,
  OKR_NOT_FOUND: 404,
  OKR_FORBIDDEN: 403,
  OKR_VERSION_CONFLICT: 409,
  PARTNER_NOT_FOUND: 404,
  PARTNER_FORBIDDEN: 403,
  PARTNER_VERSION_CONFLICT: 409,
  NOTIFICATION_FORBIDDEN: 403,
  NOTIFICATION_VERSION_CONFLICT: 409,
  VALIDATION_FAILED: 400,
  INTERNAL_ERROR: 500,
};

function publicError(error: unknown): {
  code: ErrorCode;
  message: string;
  details?: unknown;
} {
  if (error instanceof AuthError) return { code: error.code, message: error.message };
  if (error instanceof IdempotencyConflictError) {
    return { code: "IDEMPOTENCY_CONFLICT", message: error.message };
  }
  if (error instanceof ZodError) {
    return {
      code: "VALIDATION_FAILED",
      message: "request validation failed",
      details: { issues: error.issues.map(({ path, code }) => ({ path, code })) },
    };
  }
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "FST_ERR_CTP_INVALID_JSON_BODY"
  ) {
    return { code: "VALIDATION_FAILED", message: "request body is not valid JSON" };
  }
  return { code: "INTERNAL_ERROR", message: "internal server error" };
}

export function installErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    const exposed = publicError(error);
    requestContext(request).errorCode = exposed.code;
    if (exposed.code === "INTERNAL_ERROR") request.log.error({ err: error }, "request failed");
    const envelope = ErrorEnvelope.parse({
      error: {
        code: exposed.code,
        message: exposed.message,
        requestId: request.id,
        ...(exposed.details === undefined ? {} : { details: exposed.details }),
      },
    });
    return reply.code(ERROR_STATUS[exposed.code]).send(envelope);
  });
}
