import { describe, expect, test } from "vitest";

import { registerAndVerify, runCliScenario } from "./support/flows.js";

describe("file lifecycle", () => {
  test("resumes multipart bytes across devices and completes the file lifecycle", async () => {
    const alice = await registerAndVerify("files-alice", "+8613800138401");
    const result = await runCliScenario<{
      interruptedParts: number[];
      downloadedMatches: boolean;
      sameNameConflict: { exitCode: number; stderr: string };
      versions: number;
      restoredBytesMatch: boolean;
      restoredName: string;
      secondTrashExpiresAt: string;
      purged: boolean;
      usedBytes: number;
      reservedBytes: number;
    }>({ type: "files", alice });
    expect(result.interruptedParts).toEqual([1, 2]);
    expect(result.downloadedMatches).toBe(true);
    expect(result.sameNameConflict.exitCode).toBe(1);
    expect(result.sameNameConflict.stderr).toContain("FILE_NAME_CONFLICT");
    expect(result.versions).toBe(2);
    expect(result.restoredBytesMatch).toBe(true);
    expect(result.restoredName).toBe("source.txt");
    expect(Date.parse(result.secondTrashExpiresAt)).toBeGreaterThan(Date.now());
    expect(result.purged).toBe(true);
    expect(result.usedBytes).toBe(0);
    expect(result.reservedBytes).toBe(0);
  });
});
