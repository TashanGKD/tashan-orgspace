import type { ErrorCode } from "@tashan/contracts";

export class AuthError extends Error {
  public constructor(
    public readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

export function invalidCredentials(): AuthError {
  return new AuthError("AUTH_INVALID_CREDENTIALS", "phone or password is invalid");
}
