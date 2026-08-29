import { describe, expect, test } from "vitest";

import { registerAndVerify, runCliScenario } from "./support/flows.js";

describe("file lifecycle", () => {
  test("uploads, verifies, downloads, restores and queues deletion through the CLI", async () => {
    const alice = await registerAndVerify("files-alice", "+8613800138401");
    const result = await runCliScenario<{
      downloadedText: string;
      versions: number;
      restoredName: string;
      deleteQueued: boolean;
    }>({ type: "files", alice });
    expect(result).toEqual({
      downloadedText: "real MinIO bytes\n",
      versions: 1,
      restoredName: "source.txt",
      deleteQueued: true,
    });
  });
});
