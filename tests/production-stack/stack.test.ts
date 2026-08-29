import { request } from "node:http";

import { describe, expect, test } from "vitest";
import { WebSocket } from "ws";

const stackUrl = process.env.PRODUCTION_STACK_URL;
const expectedVersion = process.env.PRODUCTION_STACK_VERSION;
if (stackUrl === undefined || expectedVersion === undefined) {
  throw new Error("PRODUCTION_STACK_URL and PRODUCTION_STACK_VERSION are required");
}

async function requestVirtualHost(
  path: string,
  options: { method?: string; headers?: Record<string, string> } = {},
): Promise<{
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}> {
  return await new Promise((resolve, reject) => {
    const outgoing = request(
      new URL(path, stackUrl),
      { method: options.method, headers: options.headers },
      (incoming) => {
        const chunks: Buffer[] = [];
        incoming.on("data", (chunk: Buffer) => chunks.push(chunk));
        incoming.on("end", () => {
          resolve({
            status: incoming.statusCode ?? 0,
            headers: incoming.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );
    outgoing.once("error", reject);
    outgoing.end();
  });
}

describe("production-shaped control plane", () => {
  test("serves Web and same-origin API health", async () => {
    const web = await fetch(new URL("/", stackUrl));
    expect(web.status).toBe(200);
    expect(await web.text()).toContain('<div id="root"></div>');

    const health = await fetch(new URL("/v1/health", stackUrl));
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ status: "ok", version: expectedVersion });
  });

  test("does not authorize a foreign browser origin", async () => {
    const response = await fetch(new URL("/v1/health", stackUrl), {
      headers: { origin: "https://attacker.example" },
    });
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });

  test("proxies realtime WebSocket handshakes and rejects missing credentials", async () => {
    const url = new URL("/v1/realtime", stackUrl);
    url.protocol = "ws:";
    const closeCode = await new Promise<number>((resolve, reject) => {
      const socket = new WebSocket(url);
      socket.once("close", resolve);
      socket.once("error", reject);
    });
    expect(closeCode).toBe(4401);
  });

  test("returns security headers from the AUP gateway", async () => {
    const response = await fetch(new URL("/", stackUrl));
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("referrer-policy")).toBe("same-origin");
  });

  test("serves downloads without SPA fallback or write methods", async () => {
    const stable = await fetch(new URL("/downloads/orgspace/install-skill.sh", stackUrl));
    expect(stable.status).toBe(200);
    expect(await stable.text()).toContain("fixture installer");
    expect(stable.headers.get("cache-control")).toContain("no-cache");

    const versioned = await fetch(
      new URL(`/downloads/orgspace/v${expectedVersion}/SHA256SUMS`, stackUrl),
    );
    expect(versioned.status).toBe(200);
    expect(versioned.headers.get("cache-control")).toContain("immutable");

    const unknown = await fetch(
      new URL(`/downloads/orgspace/v${expectedVersion}/missing.tar.gz`, stackUrl),
    );
    expect(unknown.status).toBe(404);
    expect(await unknown.text()).not.toContain('<div id="root"></div>');

    const write = await fetch(new URL("/downloads/orgspace/install-skill.sh", stackUrl), {
      method: "POST",
    });
    expect([403, 405]).toContain(write.status);
  });

  test("routes the private file host without anonymous bucket access", async () => {
    const health = await requestVirtualHost("/minio/health/live", {
      headers: { host: "files.orgspace.tashan.chat" },
    });
    expect(health.status).toBe(200);

    const anonymous = await requestVirtualHost("/orgspace-files/private-object", {
      headers: { host: "files.orgspace.tashan.chat" },
    });
    expect([401, 403, 404]).toContain(anonymous.status);
    expect(anonymous.headers["access-control-allow-origin"]).not.toBe("*");
    expect(anonymous.body).not.toContain('<div id="root"></div>');

    const preflight = await requestVirtualHost("/orgspace-files/test-object", {
      method: "OPTIONS",
      headers: {
        host: "files.orgspace.tashan.chat",
        origin: "https://orgspace.tashan.chat",
        "access-control-request-method": "PUT",
      },
    });
    expect(preflight.headers["access-control-allow-origin"]).toBe("https://orgspace.tashan.chat");
  });
});
