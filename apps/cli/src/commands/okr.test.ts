import { describe, expect, test, vi } from "vitest";
import type { OrgSpaceClient } from "@tashan/sdk";
import { MemoryCredentialStore } from "../credentials/memory-store.js";
import { runCli } from "../program.js";

const deps = (client: OrgSpaceClient) => ({
  createClient: vi.fn(() => client),
  credentialStore: new MemoryCredentialStore(),
  deviceId: "3c5442ea-00e2-483b-9e81-2271e34120f1",
  environment: {},
});
describe("OKR CLI", () => {
  test("group help is side-effect free", async () => {
    const createClient = vi.fn();
    const result = await runCli(["okr"], { createClient, environment: {} });
    expect(result.exitCode).toBe(0);
    expect(createClient).not.toHaveBeenCalled();
  });
  test("progress sends current formula input and expected version", async () => {
    const updateKeyResultProgress = vi
      .fn()
      .mockResolvedValue({ keyResult: { id: crypto.randomUUID(), progress: 50 } });
    const result = await runCli(
      [
        "okr",
        "progress",
        "--org",
        "35f503c2-a5d7-4250-a337-4f4fd03cf8df",
        "--key-result",
        "84ecfe2e-c11a-4a56-8735-934955bef834",
        "--value",
        "5",
        "--expected-version",
        "1",
        "--yes",
        "--idempotency-key",
        "okr-progress-1",
      ],
      deps({ updateKeyResultProgress } as unknown as OrgSpaceClient),
    );
    expect(result.exitCode).toBe(0);
    expect(updateKeyResultProgress).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      { progress: 5, expectedVersion: 1 },
      { idempotencyKey: "okr-progress-1" },
    );
  });
});
