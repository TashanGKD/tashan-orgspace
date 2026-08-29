import { AuthError } from "../auth/auth-errors.js";
import type { DatabaseClient } from "../db/client.js";
import type { TransactionClient } from "../db/transaction.js";
import { DEFAULT_PERSONAL_QUOTA_BYTES } from "./constants.js";

export class SpaceService {
  public constructor(private readonly sql: DatabaseClient) {}

  private async refreshEffectiveQuota(transaction: TransactionClient, spaceId: string) {
    const [space] = await transaction<
      {
        id: string;
        type: "personal" | "organization";
        account_id: string | null;
        quota_bytes: string;
        used_bytes: string;
        reserved_bytes: string;
        write_state: "writable" | "quota_readonly";
      }[]
    >`select id, type, account_id, quota_bytes, used_bytes, reserved_bytes, write_state from spaces where id = ${spaceId} for update`;
    if (space === undefined) throw new AuthError("SPACE_NOT_FOUND", "space not found");
    if (space.type === "personal" && space.account_id !== null) {
      const [effective] = await transaction<{ quota_bytes: string }[]>`
        select greatest(
          ${DEFAULT_PERSONAL_QUOTA_BYTES.toString()}::bigint,
          coalesce(max(entitlement.quota_bytes), 0)
        )::text as quota_bytes
        from personal_quota_entitlements entitlement
        join memberships membership
          on membership.organization_id = entitlement.organization_id
          and membership.account_id = entitlement.account_id
          and membership.status = 'active'
        where entitlement.account_id = ${space.account_id} and entitlement.status = 'active'
      `;
      const quota = effective?.quota_bytes ?? DEFAULT_PERSONAL_QUOTA_BYTES.toString();
      const writeState = BigInt(space.used_bytes) > BigInt(quota) ? "quota_readonly" : "writable";
      await transaction`update spaces set quota_bytes = ${quota}, write_state = ${writeState}, updated_at = now() where id = ${space.id}`;
      return { ...space, quota_bytes: quota, write_state: writeState };
    }
    return space;
  }

  public async reserve(
    input: { spaceId: string; uploadSessionId: string; bytes: number },
    existingTransaction?: TransactionClient,
  ) {
    if (!Number.isSafeInteger(input.bytes) || input.bytes < 0) {
      throw new AuthError("VALIDATION_FAILED", "reservation bytes are invalid");
    }
    const operation = async (transaction: TransactionClient) => {
      const space = await this.refreshEffectiveQuota(transaction, input.spaceId);
      if (space.write_state !== "writable") {
        throw new AuthError("SPACE_READONLY", "space is read-only");
      }
      const requested = BigInt(input.bytes);
      if (
        BigInt(space.used_bytes) + BigInt(space.reserved_bytes) + requested >
        BigInt(space.quota_bytes)
      ) {
        throw new AuthError("QUOTA_EXCEEDED", "space quota exceeded");
      }
      const [reservation] = await transaction<{ id: string }[]>`
        insert into storage_reservations (space_id, upload_session_id, bytes, status)
        values (${space.id}, ${input.uploadSessionId}, ${input.bytes}, 'reserved') returning id
      `;
      if (reservation === undefined) throw new Error("storage reservation insert returned no row");
      await transaction`
        update spaces set reserved_bytes = reserved_bytes + ${input.bytes}, updated_at = now()
        where id = ${space.id}
      `;
      return reservation;
    };
    return existingTransaction === undefined
      ? ((await this.sql.begin(operation)) as { id: string })
      : operation(existingTransaction);
  }

  public async commitReservation(
    transaction: TransactionClient,
    uploadSessionId: string,
  ): Promise<void> {
    const [reservation] = await transaction<
      { id: string; space_id: string; bytes: string; status: string }[]
    >`
      select id, space_id, bytes, status from storage_reservations
      where upload_session_id = ${uploadSessionId} for update
    `;
    if (reservation === undefined || reservation.status !== "reserved") return;
    await transaction`
      update spaces set reserved_bytes = reserved_bytes - ${reservation.bytes},
        used_bytes = used_bytes + ${reservation.bytes}, updated_at = now()
      where id = ${reservation.space_id}
    `;
    await transaction`update storage_reservations set status = 'committed', updated_at = now() where id = ${reservation.id}`;
  }

  public async releaseReservation(
    transaction: TransactionClient,
    uploadSessionId: string,
  ): Promise<void> {
    const [reservation] = await transaction<
      { id: string; space_id: string; bytes: string; status: string }[]
    >`
      select id, space_id, bytes, status from storage_reservations
      where upload_session_id = ${uploadSessionId} for update
    `;
    if (reservation === undefined || reservation.status !== "reserved") return;
    await transaction`
      update spaces set reserved_bytes = reserved_bytes - ${reservation.bytes}, updated_at = now()
      where id = ${reservation.space_id}
    `;
    await transaction`update storage_reservations set status = 'released', updated_at = now() where id = ${reservation.id}`;
  }
}
