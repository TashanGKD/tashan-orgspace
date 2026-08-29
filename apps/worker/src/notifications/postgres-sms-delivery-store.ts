import type { DatabaseClient } from "../outbox-loop.js";
import type { SmsDeliveryAttemptRecord, SmsDeliveryStore } from "./aliyun-delivery.js";

export class PostgresSmsDeliveryStore implements SmsDeliveryStore {
  public constructor(
    private readonly options: {
      sql: DatabaseClient;
      templateCode: string;
      templateParamKey: string;
      clock?: () => Date;
    },
  ) {}
  private now() {
    return this.options.clock?.() ?? new Date();
  }
  public async readAttempt(id: string): Promise<SmsDeliveryAttemptRecord | undefined> {
    const [row] = await this.options.sql<
      {
        id: string;
        status: SmsDeliveryAttemptRecord["status"];
        provider_biz_id: string | null;
        provider_request_id: string | null;
        idempotency_key: string;
        phone_e164: string;
        content: string;
      }[]
    >`
      select attempt.id,attempt.status,attempt.provider_biz_id,attempt.provider_request_id,
        attempt.idempotency_key,account.phone_e164,
        coalesce(notification.body, reminder.payload->>'title', '组织通知') as content
      from notification_delivery_attempts attempt
      left join notifications notification on notification.id=attempt.notification_id
      left join scheduled_reminders reminder on reminder.id=attempt.reminder_id
      join accounts account on account.id=coalesce(notification.recipient_account_id,reminder.recipient_account_id)
      where attempt.id=${id} and attempt.channel='sms'
    `;
    if (!row || row.phone_e164 === null) return undefined;
    return {
      id: row.id,
      status: row.status,
      bizId: row.provider_biz_id,
      requestId: row.provider_request_id,
      phone: row.phone_e164,
      idempotencyKey: row.idempotency_key,
      templateCode: this.options.templateCode,
      templateParams: { [this.options.templateParamKey]: row.content },
    };
  }
  public async updateAttempt(input: {
    id: string;
    status: "accepted" | "unknown" | "delivered" | "failed";
    requestId?: string;
    bizId?: string;
    errorCode?: string;
  }) {
    const next =
      input.status === "accepted"
        ? new Date(this.now().getTime() + 30000)
        : input.status === "unknown"
          ? new Date(this.now().getTime() + 60000)
          : this.now();
    await this.options
      .sql`update notification_delivery_attempts set status=${input.status},provider_request_id=coalesce(${input.requestId ?? null},provider_request_id),provider_biz_id=coalesce(${input.bizId ?? null},provider_biz_id),last_error_code=${input.errorCode ?? null},available_at=${next},lease_owner=null,lease_expires_at=null,updated_at=${this.now()} where id=${input.id}`;
  }
}
