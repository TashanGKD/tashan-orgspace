import { describe, expect, test } from "vitest";

const stackUrl = process.env.PRODUCTION_STACK_URL;
const expectedVersion = process.env.PRODUCTION_STACK_VERSION;
if (stackUrl === undefined || expectedVersion === undefined) {
  throw new Error("PRODUCTION_STACK_URL and PRODUCTION_STACK_VERSION are required");
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
});
