import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { OrgSpaceClient } from "@tashan/sdk";
import { MemoryCredentialStore } from "../credentials/memory-store.js";
import { runCli } from "../program.js";
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => Promise.all(cleanups.splice(0).map((fn) => fn())));
const deps = (client: OrgSpaceClient) => ({
  createClient: vi.fn(() => client),
  credentialStore: new MemoryCredentialStore(),
  deviceId: "3c5442ea-00e2-483b-9e81-2271e34120f1",
  environment: {},
});
describe("partner CLI", () => {
  test("requires explicit all scope for organization export and writes 0600", async () => {
    const dir = await mkdtemp(join(tmpdir(), "partner-export-"));
    cleanups.push(() => rm(dir, { recursive: true }));
    const output = join(dir, "partners.csv");
    const exportPartners = vi
      .fn()
      .mockResolvedValue({ count: 1, content: "name,phone\n张三,13812345678\n" });
    const result = await runCli(
      [
        "partner",
        "export",
        "--org",
        "35f503c2-a5d7-4250-a337-4f4fd03cf8df",
        "--owner",
        "all",
        "--output",
        output,
        "--yes",
        "--idempotency-key",
        "export-1",
      ],
      deps({ exportPartners } as unknown as OrgSpaceClient),
    );
    expect(result.exitCode).toBe(0);
    expect(await readFile(output, "utf8")).toContain("张三");
    expect((await stat(output)).mode & 0o777).toBe(0o600);
  });
  test("does not allow implicit all-owner listing", async () => {
    const listPartners = vi.fn();
    const result = await runCli(
      ["partner", "list", "--org", "35f503c2-a5d7-4250-a337-4f4fd03cf8df", "--owner", "all"],
      deps({ listPartners } as unknown as OrgSpaceClient),
    );
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("--admin-scope");
    expect(listPartners).not.toHaveBeenCalled();
  });
});
