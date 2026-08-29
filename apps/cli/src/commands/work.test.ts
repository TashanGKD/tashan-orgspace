import { describe, expect, test, vi } from "vitest";

import type { OrgSpaceClient } from "@tashan/sdk";

import { MemoryCredentialStore } from "../credentials/memory-store.js";
import { runCli } from "../program.js";

function dependencies(client: OrgSpaceClient) {
  return {
    createClient: vi.fn(() => client),
    credentialStore: new MemoryCredentialStore(),
    deviceId: "3c5442ea-00e2-483b-9e81-2271e34120f1",
    environment: {},
  };
}

describe("work CLI", () => {
  test.each(["work", "task", "meeting", "approval", "process"])(
    "%s group prints help without loading credentials",
    async (group) => {
      const createClient = vi.fn();
      const result = await runCli([group], { createClient, environment: {} });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Usage:");
      expect(createClient).not.toHaveBeenCalled();
    },
  );

  test("task create passes an explicit organization and task type", async () => {
    const createTask = vi
      .fn()
      .mockResolvedValue({ item: { id: crypto.randomUUID(), title: "Agenda" }, assignments: [] });
    const client = { createTask } as unknown as OrgSpaceClient;
    const result = await runCli(
      [
        "task",
        "create",
        "--org",
        "35f503c2-a5d7-4250-a337-4f4fd03cf8df",
        "--title",
        "Agenda",
        "--yes",
        "--idempotency-key",
        "task-create-1",
      ],
      dependencies(client),
    );
    expect(result.exitCode).toBe(0);
    expect(createTask).toHaveBeenCalledWith(
      "35f503c2-a5d7-4250-a337-4f4fd03cf8df",
      expect.objectContaining({ type: "task", title: "Agenda" }),
      { idempotencyKey: "task-create-1" },
    );
  });

  test("destructive work actions require confirmation", async () => {
    const transitionWorkItem = vi.fn();
    const result = await runCli(
      [
        "work",
        "cancel",
        "--org",
        "35f503c2-a5d7-4250-a337-4f4fd03cf8df",
        "--work",
        "84ecfe2e-c11a-4a56-8735-934955bef834",
        "--expected-version",
        "1",
        "--idempotency-key",
        "cancel-1",
      ],
      dependencies({ transitionWorkItem } as unknown as OrgSpaceClient),
    );
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("--yes");
    expect(transitionWorkItem).not.toHaveBeenCalled();
  });
});
