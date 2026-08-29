export class SmsProviderTimeoutError extends Error {
  public constructor() {
    super("SMS provider request timed out");
    this.name = "SmsProviderTimeoutError";
  }
}
export interface SmsProvider {
  lookup(input: { phone: string; idempotencyKey: string; bizId: string | null }): Promise<{
    status: "not_found" | "pending" | "delivered" | "failed";
    requestId?: string;
    bizId?: string;
  }>;
  send(input: {
    phone: string;
    idempotencyKey: string;
    templateCode: string;
    templateParams: Record<string, string>;
  }): Promise<{ requestId: string; bizId: string }>;
}
export interface SmsDeliveryAttemptRecord {
  id: string;
  status: "pending" | "accepted" | "unknown" | "delivered" | "failed";
  bizId: string | null;
  requestId: string | null;
  phone: string;
  idempotencyKey: string;
  templateCode: string;
  templateParams: Record<string, string>;
}
export interface SmsDeliveryStore {
  readAttempt(id: string): Promise<SmsDeliveryAttemptRecord | undefined>;
  updateAttempt(input: {
    id: string;
    status: "accepted" | "unknown" | "delivered" | "failed";
    requestId?: string;
    bizId?: string;
    errorCode?: string;
  }): Promise<void>;
}
export class AliyunSmsDelivery {
  public constructor(
    private readonly options: { provider: SmsProvider; store: SmsDeliveryStore },
  ) {}
  public async process(attemptId: string): Promise<void> {
    const attempt = await this.options.store.readAttempt(attemptId);
    if (!attempt || attempt.status === "delivered" || attempt.status === "failed") return;
    const found = await this.options.provider.lookup({
      phone: attempt.phone,
      idempotencyKey: attempt.idempotencyKey,
      bizId: attempt.bizId,
    });
    if (found.status === "delivered" || found.status === "failed") {
      await this.options.store.updateAttempt({
        id: attempt.id,
        status: found.status,
        ...(found.requestId ? { requestId: found.requestId } : {}),
        ...(found.bizId ? { bizId: found.bizId } : {}),
      });
      return;
    }
    if (found.status === "pending") {
      await this.options.store.updateAttempt({
        id: attempt.id,
        status: "accepted",
        ...(found.requestId ? { requestId: found.requestId } : {}),
        ...(found.bizId ? { bizId: found.bizId } : {}),
      });
      return;
    }
    if (attempt.bizId !== null) {
      await this.options.store.updateAttempt({
        id: attempt.id,
        status: "unknown",
        errorCode: "PROVIDER_LOOKUP_NOT_FOUND",
      });
      return;
    }
    if (attempt.status === "unknown") {
      return;
    }
    try {
      const sent = await this.options.provider.send({
        phone: attempt.phone,
        idempotencyKey: attempt.idempotencyKey,
        templateCode: attempt.templateCode,
        templateParams: attempt.templateParams,
      });
      await this.options.store.updateAttempt({
        id: attempt.id,
        status: "accepted",
        requestId: sent.requestId,
        bizId: sent.bizId,
      });
    } catch (error) {
      if (error instanceof SmsProviderTimeoutError) {
        await this.options.store.updateAttempt({
          id: attempt.id,
          status: "unknown",
          errorCode: "PROVIDER_TIMEOUT",
        });
        return;
      }
      await this.options.store.updateAttempt({
        id: attempt.id,
        status: "failed",
        errorCode: "PROVIDER_SEND_FAILED",
      });
    }
  }
}
