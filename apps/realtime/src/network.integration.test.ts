import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { exportPKCS8, exportSPKI, generateKeyPair } from "jose";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { WebSocket } from "ws";
import { AccessTokenService } from "../../api/src/auth/access-token.js";
import { ChatService } from "../../api/src/chat/chat-service.js";
import { createDatabaseClient, type DatabaseClient } from "../../api/src/db/client.js";
import { migrateDatabase, resetTestDatabase } from "../../api/src/db/migrate.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const redisUrl = process.env.TEST_REDIS_URL;
if (!databaseUrl || !redisUrl) throw new Error("TEST_DATABASE_URL and TEST_REDIS_URL are required");
let sql: DatabaseClient;
beforeAll(async () => {
  await resetTestDatabase(databaseUrl);
  await migrateDatabase(databaseUrl);
  sql = createDatabaseClient(databaseUrl);
}, 30_000);
afterAll(async () => sql?.end());

async function port() {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("port allocation failed");
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}
async function stop(child: ChildProcess) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise<void>((resolve) => child.once("exit", () => resolve())),
    new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}
async function connect(url: string, token: string) {
  const protocols = ["torg.realtime.v1", `torg.token.${Buffer.from(token).toString("base64url")}`];
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      return await new Promise<WebSocket>((resolve, reject) => {
        const socket = new WebSocket(url, protocols);
        socket.once("open", () => resolve(socket));
        socket.once("error", reject);
      });
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw new Error("realtime server did not start");
}
async function waitFor<T>(values: T[], predicate: (value: T) => boolean) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const value = values.find(predicate);
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("realtime message deadline exceeded");
}

describe("production-shaped realtime delivery", () => {
  test("repairs history, streams Redis hints once and closes after membership revocation", async () => {
    const [alice] = await sql<{ id: string }[]>`
      insert into accounts(display_name,password_hash,phone_e164,phone_verified_at)
      values('Alice','hash','+8613800138791',now()) returning id
    `;
    const [bob] = await sql<{ id: string }[]>`
      insert into accounts(display_name,password_hash,phone_e164,phone_verified_at)
      values('Bob','hash','+8613800138792',now()) returning id
    `;
    const [principal] = await sql<{ id: string }[]>`
      insert into principals(account_id,type)values(${bob!.id},'human')returning id
    `;
    const deviceId = crypto.randomUUID();
    await sql`insert into devices(id,account_id,name,os,architecture,client_version)values(${deviceId},${bob!.id},'Bob test','test','test','test')`;
    const [session] = await sql<{ id: string }[]>`
      insert into sessions(account_id,principal_id,device_id,refresh_token_hash,client_channel,expires_at)
      values(${bob!.id},${principal!.id},${deviceId},${"a".repeat(64)},'cli',now()+interval '1 hour')returning id
    `;
    const [organization] = await sql<
      { id: string }[]
    >`insert into organizations(name)values('Realtime')returning id`;
    await sql`insert into memberships(organization_id,account_id,role,status)values(${organization!.id},${alice!.id},'org_owner','active'),(${organization!.id},${bob!.id},'member','active')`;
    const chat = new ChatService();
    const conversation = await sql.begin((tx) =>
      chat.createDirect(tx, alice!.id, organization!.id, { accountId: bob!.id }),
    );
    await sql.begin((tx) =>
      chat.sendMessage(tx, alice!.id, organization!.id, conversation.id, {
        clientMessageId: crypto.randomUUID(),
        body: "历史消息",
      }),
    );
    const { privateKey, publicKey } = await generateKeyPair("EdDSA", { extractable: true }),
      activeKeyId = "realtime-test-key";
    const tokens = new AccessTokenService({
      issuer: "https://api-org.tashan.chat",
      audience: "tashan-orgspace",
      activeKeyId,
      privateKey,
      publicKeys: new Map([[activeKeyId, publicKey]]),
    });
    const token = await tokens.sign({
      subject: bob!.id,
      principalId: principal!.id,
      sessionId: session!.id,
      deviceId,
      tokenVersion: 1,
      actorSource: "cli",
    });
    const realtimePort = await port();
    const child = spawn(process.execPath, ["--import", "tsx", "src/main.ts"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        REDIS_URL: redisUrl,
        HOST: "127.0.0.1",
        PORT: String(realtimePort),
        JWT_ACTIVE_KEY_ID: activeKeyId,
        JWT_PRIVATE_KEY: await exportPKCS8(privateKey),
        JWT_PUBLIC_KEY: await exportSPKI(publicKey),
      },
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => (stderr += chunk));
    try {
      const socket = await connect(`ws://127.0.0.1:${realtimePort}`, token);
      const received: Array<Record<string, unknown>> = [];
      let closeCode = 0;
      socket.on("message", (raw) =>
        received.push(JSON.parse(raw.toString()) as Record<string, unknown>),
      );
      socket.on("close", (code) => (closeCode = code));
      socket.send(
        JSON.stringify({
          type: "subscribe",
          organizationId: organization!.id,
          conversationId: conversation.id,
          afterSequence: 0,
        }),
      );
      await waitFor(received, (value) => value.type === "ready");
      expect(received.filter((value) => value.type === "event")).toHaveLength(1);
      await sql.begin((tx) =>
        chat.sendMessage(tx, alice!.id, organization!.id, conversation.id, {
          clientMessageId: crypto.randomUUID(),
          body: "实时消息",
        }),
      );
      await waitFor(received, (value) => {
        const event = value.event as { sequence?: number } | undefined;
        return value.type === "event" && event?.sequence === 2;
      });
      expect(
        received.filter(
          (value) => (value.event as { sequence?: number } | undefined)?.sequence === 2,
        ),
      ).toHaveLength(1);
      await sql`update memberships set status='removed',removed_at=now() where organization_id=${organization!.id} and account_id=${bob!.id}`;
      await sql.begin((tx) =>
        chat.sendMessage(tx, alice!.id, organization!.id, conversation.id, {
          clientMessageId: crypto.randomUUID(),
          body: "撤权后的消息",
        }),
      );
      await waitFor([0], () => closeCode === 4403);
      expect(closeCode).toBe(4403);
    } catch (error) {
      throw new Error(`realtime network test failed: ${stderr}`, { cause: error });
    } finally {
      await stop(child);
    }
  });
});
