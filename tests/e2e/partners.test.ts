import { describe, expect, test } from "vitest";
import { registerAndVerify, runCliScenario } from "./support/flows.js";
describe("partners", () => {
  test("enforces owner privacy and administrator recovery", async () => {
    const alice = await registerAndVerify("partner-admin", "+8613800138490");
    const bob = await registerAndVerify("partner-bob", "+8613800138491");
    const charlie = await registerAndVerify("partner-charlie", "+8613800138492");
    const diana = await registerAndVerify("partner-diana", "+8613800138493");
    const result = await runCliScenario<{
      bobOwnCount: number;
      adminAllCount: number;
      inferenceDenied: boolean;
      duplicateGroups: number;
      followUpCreated: boolean;
      awaitingCount: number;
      staleDenied: boolean;
      plaintextRows: number;
      exportMode: number;
    }>({ type: "partners", alice, bob, charlie, diana });
    expect(result).toMatchObject({
      bobOwnCount: 1,
      adminAllCount: 3,
      inferenceDenied: true,
      duplicateGroups: 1,
      followUpCreated: true,
      awaitingCount: 1,
      staleDenied: true,
      plaintextRows: 0,
      exportMode: 0o600,
    });
  });
});
