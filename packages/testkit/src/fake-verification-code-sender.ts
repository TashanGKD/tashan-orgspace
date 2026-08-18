export interface SentVerificationCode {
  phone: string;
  code: string;
  expiresAt: Date;
  purpose: "register" | "password_reset";
}

export class FakeVerificationCodeSender {
  public readonly available = true;
  public readonly messages: SentVerificationCode[] = [];

  public async send(input: SentVerificationCode): Promise<void> {
    this.messages.push(input);
  }
}
