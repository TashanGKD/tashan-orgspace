import { describe, expect, test, vi } from "vitest";

import { resolveCliConfig } from "../src/config.js";
import { runCli } from "../src/program.js";

describe("safe CLI defaults", () => {
  test("no args prints help without credential or network access", async () => {
    const createClient = vi.fn();
    const credentialStore = {
      read: vi.fn(),
      write: vi.fn(),
      delete: vi.fn(),
    };
    const result = await runCli([], { createClient, credentialStore, promptHidden: vi.fn() });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Usage: torg");
    expect(createClient).not.toHaveBeenCalled();
    expect(credentialStore.read).not.toHaveBeenCalled();
    expect(credentialStore.write).not.toHaveBeenCalled();
    expect(credentialStore.delete).not.toHaveBeenCalled();
  });

  test("password flag is not accepted", async () => {
    const result = await runCli(["auth", "login", "--password", "secret"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("unknown option '--password'");
    expect(result.stdout + result.stderr).not.toContain("secret");
  });

  test("json mode emits exactly one JSON value", async () => {
    const result = await runCli(["--json"]);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout.trim().split("\n")).toHaveLength(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      help: expect.stringContaining("Usage: torg"),
    });
  });

  test("development URL defaults to loopback and production requires explicit configuration", () => {
    expect(resolveCliConfig({})).toMatchObject({ apiUrl: "http://127.0.0.1:4110" });
    expect(() => resolveCliConfig({ TORG_ENV: "production" })).toThrow("TORG_API_URL is required");
    expect(
      resolveCliConfig({ TORG_ENV: "production", TORG_API_URL: "https://api-org.tashan.chat" }),
    ).toMatchObject({ apiUrl: "https://api-org.tashan.chat" });
  });
});
