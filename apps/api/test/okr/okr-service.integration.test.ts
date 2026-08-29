import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";

import { createDatabaseClient, type DatabaseClient } from "../../src/db/client.js";
import { migrateDatabase, resetTestDatabase } from "../../src/db/migrate.js";
import { OkrService } from "../../src/okr/okr-service.js";

const url = process.env.TEST_DATABASE_URL;
if (url === undefined) throw new Error("TEST_DATABASE_URL is required");
let sql: DatabaseClient;
beforeAll(async () => {
  await resetTestDatabase(url);
  await migrateDatabase(url);
  sql = createDatabaseClient(url);
}, 30_000);
beforeEach(async () => {
  await sql`truncate table audit_events, outbox_events, session_refresh_tokens, sessions, devices, memberships, organizations, phone_verifications, principals, accounts cascade`;
});
afterAll(async () => sql?.end());

async function fixture() {
  const ids: string[] = [];
  for (const [index, name] of ["Admin", "Member"].entries()) {
    const [row] = await sql<{ id: string }[]>`
      insert into accounts (display_name, password_hash, phone_e164, phone_verified_at)
      values (${name}, 'hash', ${`+861380013845${index}`}, now()) returning id
    `;
    if (row === undefined) throw new Error("account fixture failed");
    ids.push(row.id);
  }
  const [admin, member] = ids;
  const [orgA] = await sql<
    { id: string }[]
  >`insert into organizations (name) values ('OKR A') returning id`;
  const [orgB] = await sql<
    { id: string }[]
  >`insert into organizations (name) values ('OKR B') returning id`;
  if (admin === undefined || member === undefined || orgA === undefined || orgB === undefined)
    throw new Error("OKR fixture failed");
  await sql`insert into memberships (organization_id, account_id, role, status) values
    (${orgA.id}, ${admin}, 'org_owner', 'active'), (${orgA.id}, ${member}, 'member', 'active'),
    (${orgB.id}, ${admin}, 'org_owner', 'active')`;
  return { admin, member, orgA: orgA.id, orgB: orgB.id };
}

describe("OKR service", () => {
  test("rejects cross-organization linked tasks", async () => {
    const actor = await fixture();
    const [outside] = await sql<{ id: string }[]>`
      insert into work_items (organization_id, type, title, priority, created_by_account_id)
      values (${actor.orgB}, 'task', 'Outside', 'normal', ${actor.admin}) returning id
    `;
    if (outside === undefined) throw new Error("outside task missing");
    const service = new OkrService();
    await expect(
      sql.begin((tx) =>
        service.createObjective(tx, actor.member, actor.orgA, {
          title: "Objective",
          cycle: "2026-Q3",
          keyResults: [
            {
              title: "Delivery",
              weight: 100,
              formula: { type: "linked_tasks", workItemIds: [outside.id] },
            },
          ],
        }),
      ),
    ).rejects.toMatchObject({ code: "OKR_FORBIDDEN" });
  });

  test("applies progress immediately and preserves formula input snapshots", async () => {
    const actor = await fixture();
    const service = new OkrService();
    const objective = await sql.begin((tx) =>
      service.createObjective(tx, actor.member, actor.orgA, {
        title: "Objective",
        cycle: "2026-Q3",
        keyResults: [
          { title: "Calls", weight: 100, formula: { type: "numeric", start: 0, target: 10 } },
        ],
      }),
    );
    const kr = objective.keyResults[0];
    if (kr === undefined) throw new Error("KR missing");
    const updated = await sql.begin((tx) =>
      service.updateProgress(tx, actor.member, kr.id, { progress: 5, expectedVersion: kr.version }),
    );
    expect(updated.keyResult.progress).toBe(50);
    const [event] = await sql<
      { formula_version: number; input_snapshot: unknown; progress: number }[]
    >`
      select formula_version, input_snapshot, progress::float8 as progress from okr_progress_events
      where key_result_id = ${kr.id} order by created_at desc limit 1
    `;
    expect(event).toMatchObject({
      formula_version: 1,
      input_snapshot: { current: 5, start: 0, target: 10 },
      progress: 50,
    });
  });

  test("routes member substantive edits through an assigned change request", async () => {
    const actor = await fixture();
    const service = new OkrService();
    const objective = await sql.begin((tx) =>
      service.createObjective(tx, actor.member, actor.orgA, {
        title: "Original",
        cycle: "2026-Q3",
        keyResults: [{ title: "Manual", weight: 100, formula: { type: "manual" } }],
      }),
    );
    await expect(
      sql.begin((tx) =>
        service.editObjectiveDirect(tx, actor.member, objective.objective.id, {
          patch: { title: "Bypass" },
          expectedVersion: 1,
        }),
      ),
    ).rejects.toMatchObject({ code: "OKR_FORBIDDEN" });
    const requested = await sql.begin((tx) =>
      service.requestChange(tx, actor.member, objective.objective.id, {
        patch: { title: "Proposed", cycle: "2026-Q4" },
        expectedVersion: 1,
      }),
    );
    expect(requested.workItem.item.type).toBe("change_request");
    expect(requested.workItem.assignments).toEqual([
      expect.objectContaining({ assigneeAccountId: actor.admin }),
    ]);
    const approved = await sql.begin((tx) =>
      service.approveChange(tx, actor.admin, requested.changeRequest.id, {
        expectedObjectiveVersion: 1,
      }),
    );
    expect(approved.objective).toMatchObject({ title: "Proposed", cycle: "2026-Q4", version: 2 });
  });

  test("records equivalent substantive-change events for approval and administrator direct edit", async () => {
    const actor = await fixture();
    const service = new OkrService();
    const objective = await sql.begin((tx) =>
      service.createObjective(tx, actor.member, actor.orgA, {
        title: "One",
        cycle: "2026-Q3",
        keyResults: [{ title: "Manual", weight: 100, formula: { type: "manual" } }],
      }),
    );
    const direct = await sql.begin((tx) =>
      service.editObjectiveDirect(tx, actor.admin, objective.objective.id, {
        patch: { title: "Admin edit" },
        expectedVersion: 1,
      }),
    );
    expect(direct.objective.version).toBe(2);
    const events = await sql<{ event_type: string; payload: Record<string, unknown> }[]>`
      select event_type, payload from domain_events where aggregate_id = ${objective.objective.id}
      order by sequence
    `;
    expect(events.at(-1)).toMatchObject({
      event_type: "okr.objective.changed",
      payload: { source: "admin_direct" },
    });
  });
});
