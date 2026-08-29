import { setTimeout as delay } from "node:timers/promises";
import { importPKCS8, importSPKI } from "jose";
import postgres from "postgres";
import { createClient } from "redis";
import { WebSocket, WebSocketServer } from "ws";
import { z } from "zod";
import { AccessTokenService } from "../../api/src/auth/access-token.js";
import { SessionAuthenticator } from "../../api/src/auth/session-authenticator.js";
import { ChatService } from "../../api/src/chat/chat-service.js";
import { requireConversationAccess } from "../../api/src/chat/chat-authorization.js";
import { accessTokenFromProtocols } from "./auth-protocol.js";
import { RealtimeCursorSubscription } from "./cursor.js";
import { DurableEventRelay } from "./relay.js";

const SubscribeMessage = z
  .object({
    type: z.literal("subscribe"),
    organizationId: z.uuid(),
    conversationId: z.uuid(),
    afterSequence: z.number().int().min(0),
  })
  .strict();
function required(key: string) {
  const value = process.env[key]?.trim();
  if (!value) throw new Error(`${key} is required`);
  return value;
}
const databaseUrl = required("DATABASE_URL"),
  redisUrl = required("REDIS_URL"),
  host = process.env.HOST?.trim() || "127.0.0.1",
  port = z.coerce
    .number()
    .int()
    .min(1)
    .max(65_535)
    .parse(process.env.PORT ?? 4120);
const sql = postgres(databaseUrl, { max: 10, prepare: false });
const publisher = createClient({ url: redisUrl }),
  subscriber = publisher.duplicate();
await Promise.all([publisher.connect(), subscriber.connect()]);
const privateKey = await importPKCS8(required("JWT_PRIVATE_KEY"), "EdDSA"),
  publicKey = await importSPKI(required("JWT_PUBLIC_KEY"), "EdDSA"),
  activeKeyId = required("JWT_ACTIVE_KEY_ID");
const tokenService = new AccessTokenService({
  issuer: process.env.JWT_ISSUER?.trim() || "https://api-org.tashan.chat",
  audience: process.env.JWT_AUDIENCE?.trim() || "tashan-orgspace",
  activeKeyId,
  privateKey,
  publicKeys: new Map([[activeKeyId, publicKey]]),
});
const authenticator = new SessionAuthenticator(sql, tokenService),
  chat = new ChatService(),
  clients = new Set<Client>();
type ChatEvent = Awaited<ReturnType<ChatService["listEvents"]>>["items"][number];
interface Client {
  socket: WebSocket;
  token: string;
  organizationId?: string;
  conversationId?: string;
  subscription?: RealtimeCursorSubscription<ChatEvent>;
  queue: Promise<void>;
}
function enqueue(client: Client, work: () => Promise<void>) {
  client.queue = client.queue.then(work).catch(() => {
    client.socket.close(4403, "subscription unavailable");
  });
}
const server = new WebSocketServer({
  host,
  port,
  maxPayload: 16 * 1024,
  handleProtocols: (protocols) => (protocols.has("torg.realtime.v1") ? "torg.realtime.v1" : false),
});
server.on("connection", (socket, request) => {
  let token: string;
  try {
    token = accessTokenFromProtocols(request.headers["sec-websocket-protocol"]);
  } catch {
    socket.close(4401, "authentication required");
    return;
  }
  const client: Client = { socket, token, queue: Promise.resolve() };
  clients.add(client);
  socket.on("close", () => clients.delete(client));
  socket.on("message", (raw) => {
    enqueue(client, async () => {
      if (client.subscription) throw new Error("already subscribed");
      const input = SubscribeMessage.parse(JSON.parse(raw.toString()) as unknown);
      const identity = await authenticator.authenticate(client.token);
      client.organizationId = input.organizationId;
      client.conversationId = input.conversationId;
      client.subscription = new RealtimeCursorSubscription(input.afterSequence, {
        authorize: async () => {
          const current = await authenticator.authenticate(client.token);
          await sql.begin((tx) =>
            requireConversationAccess(
              tx,
              current.accountId,
              input.organizationId,
              input.conversationId,
            ),
          );
        },
        load: async (afterSequence) =>
          sql.begin(
            async (tx) =>
              (
                await chat.listEvents(
                  tx,
                  identity.accountId,
                  input.organizationId,
                  input.conversationId,
                  { afterSequence, limit: 200 },
                )
              ).items,
          ),
        emit: (event) => {
          if (socket.readyState === WebSocket.OPEN)
            socket.send(JSON.stringify({ type: "event", event }));
        },
      });
      await client.subscription.sync();
      socket.send(JSON.stringify({ type: "ready", cursor: client.subscription.current() }));
    });
  });
});

const channel = "orgspace:chat-events";
await subscriber.subscribe(channel, (raw) => {
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw) as unknown;
  } catch {
    return;
  }
  const parsed = z
    .object({ conversationId: z.uuid(), sequence: z.number().int().min(1) })
    .strict()
    .safeParse(decoded);
  if (!parsed.success) return;
  const hint = parsed.data;
  for (const client of clients) {
    if (client.conversationId === hint.conversationId && client.subscription)
      enqueue(client, () => client.subscription!.sync(hint.sequence).then(() => undefined));
  }
});
let running = true;
const [latest] = await sql<{ position: number | string }[]>`
  select coalesce(max(global_position),0) position from chat_events
`;
const durableRelay = new DurableEventRelay(Number(latest?.position ?? 0), {
  readAfter: async (globalPosition) => {
    const rows = await sql<
      { global_position: number | string; conversation_id: string; sequence: number | string }[]
    >`
      select global_position,conversation_id,sequence from chat_events
      where global_position>${globalPosition} order by global_position limit 200
    `;
    return rows.map((row) => ({
      globalPosition: Number(row.global_position),
      conversationId: row.conversation_id,
      sequence: Number(row.sequence),
    }));
  },
  publish: (hint) => publisher.publish(channel, JSON.stringify(hint)).then(() => undefined),
});
const relay = (async () => {
  while (running) {
    if ((await durableRelay.processOnce()) === 0) await delay(100);
  }
})();
async function shutdown() {
  if (!running) return;
  running = false;
  for (const client of clients) client.socket.close(1001, "server shutdown");
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await relay;
  await Promise.all([subscriber.close(), publisher.close(), sql.end()]);
}
process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
