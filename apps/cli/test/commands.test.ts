import { describe, expect, test, vi } from "vitest";

import type { OrgSpaceClient } from "@tashan/sdk";

import { MemoryCredentialStore } from "../src/credentials/memory-store.js";
import { CliOutput } from "../src/output.js";
import { buildProgram, registeredCapabilityIds, runCli } from "../src/program.js";
import { capabilityBindings } from "../src/bindings.js";

const deviceId = "35f503c2-a5d7-4250-a337-4f4fd03cf8df";
const accountId = "b228e557-2214-4f95-b49d-d4ff7d9759d4";
const principalId = "af4ec631-8335-4c2b-9a02-df7033d45c55";
const sessionId = "3c5442ea-00e2-483b-9e81-2271e34120f1";

function loginResponse() {
  return {
    account: {
      id: accountId,
      username: "alice",
      phone: null,
      phoneVerifiedAt: null,
      status: "active" as const,
      createdAt: "2026-08-18T12:00:00.000Z",
    },
    principal: { id: principalId, type: "human" as const, accountId },
    sessionId,
    deviceId,
    tokens: {
      tokenType: "Bearer" as const,
      accessToken: "access-token-must-not-print",
      accessTokenExpiresAt: "2026-08-18T12:15:00.000Z",
      refreshToken: "refresh-token-must-not-print-and-is-long-enough",
      refreshTokenExpiresAt: "2026-09-17T12:00:00.000Z",
    },
  };
}

function fakeClient(overrides: Partial<Record<keyof OrgSpaceClient, unknown>> = {}) {
  return {
    login: vi.fn().mockResolvedValue(loginResponse()),
    createOrganization: vi.fn(),
    revokeDevice: vi.fn(),
    listCapabilities: vi.fn().mockResolvedValue({ items: [] }),
    ...overrides,
  } as unknown as OrgSpaceClient;
}

function dependencies(client: OrgSpaceClient, overrides: Record<string, unknown> = {}) {
  return {
    createClient: vi.fn(() => client),
    credentialStore: new MemoryCredentialStore(),
    promptHidden: vi.fn(async () => "CorrectHorseBattery9"),
    readStdin: vi.fn(async () => "CorrectHorseBattery9\n"),
    deviceId,
    environment: {},
    ...overrides,
  };
}

describe("Phase 0 command behavior", () => {
  test("registers an executable command for every capability binding", () => {
    expect([...registeredCapabilityIds].sort()).toEqual(Object.keys(capabilityBindings).sort());

    const program = buildProgram(new CliOutput());
    const leafPaths: string[] = [];
    const visit = (command: typeof program, prefix: string[]): void => {
      if (command.commands.length === 0 && prefix.length > 0) leafPaths.push(prefix.join(" "));
      for (const child of command.commands) visit(child, [...prefix, child.name()]);
    };
    visit(program, []);
    expect(leafPaths.sort()).toEqual(Object.values(capabilityBindings).sort());
  });

  test("login prompts securely and never prints tokens", async () => {
    const sdk = fakeClient();
    const effects = dependencies(sdk);
    const result = await runCli(["auth", "login", "--username", "alice"], effects);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Logged in as alice");
    expect(result.stdout + result.stderr).not.toContain("access-token-must-not-print");
    expect(result.stdout + result.stderr).not.toContain("refresh-token-must-not-print");
    expect(sdk.login).toHaveBeenCalledWith(
      expect.objectContaining({
        username: "alice",
        password: "CorrectHorseBattery9",
        device: expect.objectContaining({ id: deviceId, channel: "cli" }),
      }),
    );
  });

  test("organization creation requires explicit idempotency key before network access", async () => {
    const sdk = fakeClient();
    const effects = dependencies(sdk);
    const result = await runCli(["org", "create", "--name", "Tashan", "--json", "--yes"], effects);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("--idempotency-key");
    expect(effects.createClient).not.toHaveBeenCalled();
    expect(sdk.createOrganization).not.toHaveBeenCalled();
  });

  test("device revoke refuses the current device unless separately allowed", async () => {
    const sdk = fakeClient();
    const effects = dependencies(sdk);
    const base = ["device", "revoke", deviceId, "--yes", "--idempotency-key", "revoke-1"];
    const refused = await runCli(base, effects);
    expect(refused.exitCode).toBe(2);
    expect(refused.stderr).toContain("--allow-current-device");
    expect(sdk.revokeDevice).not.toHaveBeenCalled();

    sdk.revokeDevice = vi.fn().mockResolvedValue({
      deviceId,
      revokedAt: "2026-08-18T12:00:00.000Z",
    });
    const allowed = await runCli([...base, "--allow-current-device"], effects);
    expect(allowed.exitCode).toBe(0);
    expect(sdk.revokeDevice).toHaveBeenCalledWith(deviceId, { idempotencyKey: "revoke-1" });
  });

  test("JSON command output is one machine-readable value", async () => {
    const sdk = fakeClient({
      listCapabilities: vi.fn().mockResolvedValue({
        items: [{ id: "system.health.read", version: 1 }],
      }),
    });
    const result = await runCli(["capability", "list", "--json"], dependencies(sdk));
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout.trim().split("\n")).toHaveLength(1);
    expect(JSON.parse(result.stdout)).toMatchObject({ items: [{ id: "system.health.read" }] });
  });
});
