import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";

import { createDatabaseClient, type DatabaseClient } from "../../src/db/client.js";
import { migrateDatabase, resetTestDatabase } from "../../src/db/migrate.js";
import { SpaceService } from "../../src/spaces/space-service.js";
import { createPersonalSpace } from "../../src/spaces/space-bootstrap.js";

const url = process.env.TEST_DATABASE_URL;
if (url === undefined) throw new Error("TEST_DATABASE_URL is required");
let sql: DatabaseClient;
beforeAll(async () => {
  await resetTestDatabase(url);
  await migrateDatabase(url);
  sql = createDatabaseClient(url);
}, 30_000);
beforeEach(async () => {
  await sql`truncate table audit_events, session_refresh_tokens, sessions, devices, memberships, organizations, phone_verifications, principals, accounts cascade`;
});
afterAll(async () => sql?.end());

describe("quota reservations", () => {
  test("serializes concurrent reservations for the final bytes", async () => {
    const [account] = await sql<{ id: string }[]>`
      insert into accounts (display_name, password_hash, phone_e164, phone_verified_at)
      values ('Owner', 'hash', '+8613800138799', now()) returning id
    `;
    if (account === undefined) throw new Error("account fixture failed");
    const space = await sql.begin((transaction) => createPersonalSpace(transaction, account.id));
    await sql`update spaces set used_bytes = 53687091190 where id = ${space.id}`;
    const service = new SpaceService(sql);
    const uploadA = crypto.randomUUID();
    const uploadB = crypto.randomUUID();
    for (const [uploadId, key] of [
      [uploadA, "reserve-a"],
      [uploadB, "reserve-b"],
    ] as const) {
      await sql`
        insert into upload_sessions (
          id, space_id, parent_id, created_by_account_id, file_name, normalized_name,
          content_type, expected_size_bytes, temporary_object_key, part_size_bytes,
          part_count, status, expires_at, idempotency_key
        ) values (
          ${uploadId}, ${space.id}, ${space.rootFolderId}, ${account.id}, 'data.bin', 'data.bin',
          'application/octet-stream', 7, ${`temporary/${uploadId}`}, 16777216,
          1, 'created', now() + interval '1 hour', ${key}
        )
      `;
    }
    const results = await Promise.allSettled([
      service.reserve({ spaceId: space.id, uploadSessionId: uploadA, bytes: 7 }),
      service.reserve({ spaceId: space.id, uploadSessionId: uploadB, bytes: 7 }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(results.find((result) => result.status === "rejected")).toMatchObject({
      reason: { code: "QUOTA_EXCEEDED" },
    });
  });

  test("commits and releases a reservation at most once", async () => {
    const [account] = await sql<{ id: string }[]>`
      insert into accounts (display_name, password_hash, phone_e164, phone_verified_at)
      values ('Owner', 'hash', '+8613800138798', now()) returning id
    `;
    if (account === undefined) throw new Error("account fixture failed");
    const space = await sql.begin((transaction) => createPersonalSpace(transaction, account.id));
    const service = new SpaceService(sql);
    const uploadId = crypto.randomUUID();
    await sql`
      insert into upload_sessions (
        id, space_id, parent_id, created_by_account_id, file_name, normalized_name,
        content_type, expected_size_bytes, temporary_object_key, part_size_bytes,
        part_count, status, expires_at, idempotency_key
      ) values (
        ${uploadId}, ${space.id}, ${space.rootFolderId}, ${account.id}, 'one.bin', 'one.bin',
        'application/octet-stream', 5, ${`temporary/${uploadId}`}, 16777216,
        1, 'created', now() + interval '1 hour', 'one-reservation'
      )
    `;
    await service.reserve({ spaceId: space.id, uploadSessionId: uploadId, bytes: 5 });
    await sql.begin((transaction) => service.commitReservation(transaction, uploadId));
    await sql.begin((transaction) => service.commitReservation(transaction, uploadId));
    await sql.begin((transaction) => service.releaseReservation(transaction, uploadId));
    const [usage] = await sql<{ used_bytes: string; reserved_bytes: string }[]>`
      select used_bytes, reserved_bytes from spaces where id = ${space.id}
    `;
    expect(usage).toEqual({ used_bytes: "5", reserved_bytes: "0" });
  });
});
