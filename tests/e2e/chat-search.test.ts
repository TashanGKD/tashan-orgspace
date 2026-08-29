import { describe, expect, test } from "vitest";
import { registerAndVerify, runCliScenario } from "./support/flows.js";

describe("chat, realtime and search", () => {
  test("runs multi-user history, realtime, mention, conversion, withdrawal and revocation", async () => {
    const alice = await registerAndVerify("chat-alice", "+8613800138441");
    const bob = await registerAndVerify("chat-bob", "+8613800138442");
    const charlie = await registerAndVerify("chat-charlie", "+8613800138443");
    const result = await runCliScenario<{
      crossDenied: boolean;
      historyEvents: number;
      cliStreamed: number;
      searchBefore: number;
      searchAfter: number;
      hasMention: boolean;
      convertedTaskId: string;
      revokedClose: number;
      staleDenied: boolean;
    }>({ type: "chat-search", alice, bob, charlie });
    expect(result.crossDenied).toBe(true);
    expect(result.historyEvents).toBeGreaterThanOrEqual(2);
    expect(result.cliStreamed).toBe(1);
    expect(result.searchBefore).toBe(1);
    expect(result.searchAfter).toBe(0);
    expect(result.hasMention).toBe(true);
    expect(result.convertedTaskId).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.revokedClose).toBe(4403);
    expect(result.staleDenied).toBe(true);
  });
});
