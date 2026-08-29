import { describe, expect, test, vi } from "vitest";
import type { OrgSpaceClient } from "@tashan/sdk";
import { MemoryCredentialStore } from "../credentials/memory-store.js";
import { runCli } from "../program.js";

describe("My Work CLI", () => {
  test("lists current-account references without requiring an organization argument", async () => {
    const listMyWork = vi.fn().mockResolvedValue({ items: [] });
    const result = await runCli(["my-work", "list", "--kind", "approval"], {
      createClient: vi.fn(() => ({ listMyWork }) as unknown as OrgSpaceClient),
      credentialStore: new MemoryCredentialStore(),
      deviceId: "3c5442ea-00e2-483b-9e81-2271e34120f1",
      environment: {},
    });
    expect(result.exitCode).toBe(0);
    expect(listMyWork).toHaveBeenCalledWith({ kind: "approval" });
  });
});
