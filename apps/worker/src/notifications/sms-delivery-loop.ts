import type { DatabaseClient } from "../outbox-loop.js";
import type { AliyunSmsDelivery } from "./aliyun-delivery.js";
export class SmsDeliveryLoop {
  private stopping = false;
  private readonly clock: () => Date;
  private readonly poll: number;
  public constructor(
    private readonly options: {
      sql: DatabaseClient;
      delivery: AliyunSmsDelivery;
      workerId: string;
      clock?: () => Date;
      pollMilliseconds?: number;
    },
  ) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(options.workerId))
      throw new Error("worker ID invalid");
    this.clock = options.clock ?? (() => new Date());
    this.poll = options.pollMilliseconds ?? 500;
  }
  public async processOnce() {
    if (this.stopping) return 0;
    const now = this.clock(),
      lease = new Date(now.getTime() + 60000);
    const rows = await this.options.sql<
      { id: string }[]
    >`with candidates as(select id from notification_delivery_attempts where channel='sms' and status in('pending','accepted','unknown') and available_at<=${now} and(lease_owner is null or lease_expires_at<=${now}) order by available_at,id for update skip locked limit 20)update notification_delivery_attempts attempt set attempts=attempts+1,lease_owner=${this.options.workerId},lease_expires_at=${lease},updated_at=${now} from candidates where attempt.id=candidates.id returning attempt.id`;
    for (const row of rows) await this.options.delivery.process(row.id);
    return rows.length;
  }
  public async run() {
    while (!this.stopping) {
      const n = await this.processOnce();
      if (n === 0 && !this.stopping) await new Promise((r) => setTimeout(r, this.poll));
    }
  }
  public async stop() {
    this.stopping = true;
    await this.options
      .sql`update notification_delivery_attempts set lease_owner=null,lease_expires_at=null where lease_owner=${this.options.workerId}`;
  }
}
