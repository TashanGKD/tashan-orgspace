import { describe, expect, test, vi } from "vitest";
import type { OrgSpaceClient } from "@tashan/sdk";
import { MemoryCredentialStore } from "../credentials/memory-store.js";
import { runCli } from "../program.js";

describe("search CLI", () => {
  test("sends an explicit organization and typed authorized query", async () => {
    const searchOrganization = vi.fn().mockResolvedValue({ groups: [], totalAuthorized: 0 });
    const result = await runCli(
      [
        "search",
        "query",
        "--org",
        "35f503c2-a5d7-4250-a337-4f4fd03cf8df",
        "--text",
        "量子",
        "--type",
        "file",
        "message",
      ],
      {
        createClient: vi.fn(() => ({ searchOrganization }) as unknown as OrgSpaceClient),
        credentialStore: new MemoryCredentialStore(),
        deviceId: "3c5442ea-00e2-483b-9e81-2271e34120f1",
        environment: {},
      },
    );
    expect(result.exitCode).toBe(0);
    expect(searchOrganization).toHaveBeenCalledWith(expect.any(String), {
      query: "量子",
      limit: 30,
      types: ["file", "message"],
    });
  });
});
