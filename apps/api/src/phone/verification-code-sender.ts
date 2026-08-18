import { AuthError } from "../auth/auth-errors.js";

export interface VerificationCodeSender {
  readonly available: boolean;
  send(input: { phone: string; code: string; expiresAt: Date }): Promise<void>;
}

export class UnavailableVerificationCodeSender implements VerificationCodeSender {
  public readonly available = false;

  public async send(): Promise<void> {
    throw new AuthError("PHONE_PROVIDER_UNAVAILABLE", "phone verification provider is unavailable");
  }
}
