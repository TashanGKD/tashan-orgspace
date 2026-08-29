import { generateKeyPair } from "jose";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { FakeVerificationCodeSender } from "@tashan/testkit";
import { NotificationProjector } from "../../../worker/src/notifications/notification-projector.js";
import { AccessTokenService } from "../../src/auth/access-token.js";
import { buildApp } from "../../src/app.js";
import { createDatabaseClient, type DatabaseClient } from "../../src/db/client.js";
import { migrateDatabase, resetTestDatabase } from "../../src/db/migrate.js";
import { testFileDataStore } from "../http/test-file-store.js";

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL required");
let sql: DatabaseClient;
let tokens: AccessTokenService;
let app: Awaited<ReturnType<typeof buildApp>>;
class AllowAll {
  public async consume() {
    return true;
  }
}
beforeAll(async () => {
  await resetTestDatabase(url);
  await migrateDatabase(url);
  sql = createDatabaseClient(url);
  const { privateKey, publicKey } = await generateKeyPair("EdDSA");
  tokens = new AccessTokenService({
    issuer: "https://api-org.tashan.chat",
    audience: "tashan-orgspace",
    activeKeyId: "chat-http-test",
    privateKey,
    publicKeys: new Map([["chat-http-test", publicKey]]),
  });
}, 30_000);
beforeEach(async () => {
  await sql`truncate table audit_events,outbox_events,session_refresh_tokens,sessions,devices,memberships,organizations,phone_verifications,principals,accounts cascade`;
  app = await buildApp({
    sql,
    tokenService: tokens,
    serviceVersion: "0.0.0-test",
    phoneSender: new FakeVerificationCodeSender(),
    loginRateLimiter: new AllowAll(),
    phoneRateLimiter: new AllowAll(),
    phoneCodePepper: "chat-http-test-pepper",
    trustedProxyCidrs: [],
    corsOrigins: ["https://org.tashan.chat"],
    fileDataStore: testFileDataStore(),
  });
});
afterAll(async () => {
  await app?.close();
  await sql?.end();
});
async function identity(name: string, phone: string) {
  const [account] = await sql<{ id: string }[]>`
    insert into accounts(display_name,password_hash,phone_e164,phone_verified_at)
    values(${name},'hash',${phone},now())returning id
  `;
  const [principal] = await sql<{ id: string }[]>`
    insert into principals(account_id,type)values(${account!.id},'human')returning id
  `;
  const deviceId = crypto.randomUUID();
  await sql`insert into devices(id,account_id,name,os,architecture,client_version)values(${deviceId},${account!.id},${name},'test','test','test')`;
  const [session] = await sql<{ id: string }[]>`
    insert into sessions(account_id,principal_id,device_id,refresh_token_hash,client_channel,expires_at)
    values(${account!.id},${principal!.id},${deviceId},${crypto.randomUUID()},'cli',now()+interval '1 hour')returning id
  `;
  return {
    accountId: account!.id,
    token: await tokens.sign({
      subject: account!.id,
      principalId: principal!.id,
      sessionId: session!.id,
      deviceId,
      tokenVersion: 1,
      actorSource: "cli",
    }),
  };
}
const headers = (token: string, key?: string) => ({
  authorization: `Bearer ${token}`,
  "x-torg-invocation-source": "ai_via_cli",
  ...(key ? { "idempotency-key": key } : {}),
});

describe("chat HTTP audit and notification integration", () => {
  test("audits compliance and projects a converted message into a member notification", async () => {
    const alice = await identity("Alice", "+8613800138771"),
      bob = await identity("Bob", "+8613800138772");
    const [org] = await sql<
      { id: string }[]
    >`insert into organizations(name)values('Chat HTTP')returning id`;
    await sql`insert into memberships(organization_id,account_id,role,status)values(${org!.id},${alice.accountId},'org_owner','active'),(${org!.id},${bob.accountId},'member','active')`;
    const direct = await app.inject({
      method: "POST",
      url: `/v1/organizations/${org!.id}/conversations/direct`,
      headers: headers(alice.token, "chat-http-direct"),
      payload: { accountId: bob.accountId },
    });
    expect(direct.statusCode, direct.body).toBe(201);
    const conversationId = direct.json<{ id: string }>().id;
    const sent = await app.inject({
      method: "POST",
      url: `/v1/organizations/${org!.id}/conversations/${conversationId}/messages`,
      headers: headers(alice.token, "chat-http-send"),
      payload: { clientMessageId: crypto.randomUUID(), body: "请整理纪要" },
    });
    expect(sent.statusCode, sent.body).toBe(201);
    const messageId = sent.json<{ id: string }>().id;
    const converted = await app.inject({
      method: "POST",
      url: `/v1/organizations/${org!.id}/conversations/${conversationId}/messages/${messageId}/convert`,
      headers: headers(alice.token, "chat-http-convert"),
      payload: { type: "task", title: "整理纪要", assigneeAccountIds: [bob.accountId] },
    });
    expect(converted.statusCode, converted.body).toBe(200);
    const [domainEvent] = await sql<{ id: string }[]>`
      select id from domain_events where event_type='work.created' order by created_at desc limit 1
    `;
    expect(domainEvent?.id).toBeDefined();
    await new NotificationProjector(sql).project(domainEvent!.id);
    const [notification] = await sql<{ event_type: string; title: string }[]>`
      select event_type,title from notifications where recipient_account_id=${bob.accountId} and title='整理纪要'
    `;
    expect(notification).toEqual({ event_type: "ordinary_task", title: "整理纪要" });

    const now = Date.now();
    const payload = {
      conversationId,
      reason: "调查组织信息泄露事件",
      startsAt: new Date(now - 3_600_000).toISOString(),
      endsAt: new Date(now + 3_600_000).toISOString(),
    };
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/v1/organizations/${org!.id}/chat-compliance-reviews`,
          headers: headers(alice.token, "chat-http-compliance"),
          payload,
        })
      ).statusCode,
    ).toBe(201);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/v1/organizations/${org!.id}/chat-compliance-reviews`,
          headers: headers(bob.token, "chat-http-compliance-denied"),
          payload,
        })
      ).statusCode,
    ).toBe(403);
    const audit = await sql<{ capability_id: string; result: string }[]>`
      select capability_id,result from audit_events
      where capability_id in('chat.message.convert','chat.compliance.create')
      order by chain_position
    `;
    expect(audit).toEqual(
      expect.arrayContaining([
        { capability_id: "chat.message.convert", result: "success" },
        { capability_id: "chat.compliance.create", result: "success" },
        { capability_id: "chat.compliance.create", result: "rejected" },
      ]),
    );
  });
});
