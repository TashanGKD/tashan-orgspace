import { describe, expect, test } from "vitest";
import { accessTokenFromProtocols } from "./auth-protocol.js";

const jwt = `${"a".repeat(20)}.${"b".repeat(20)}.${"c".repeat(20)}`;
const encoded = Buffer.from(jwt).toString("base64url");
describe("realtime WebSocket protocol authentication", () => {
  test("accepts one encoded bearer token without putting it in the URL", () => {
    expect(accessTokenFromProtocols(`torg.realtime.v1, torg.token.${encoded}`)).toBe(jwt);
  });
  test.each([
    undefined,
    "torg.realtime.v1",
    `torg.realtime.v1,torg.token.${encoded},torg.token.${encoded}`,
    "torg.realtime.v1,torg.token.not-base64!",
  ])("rejects malformed or ambiguous protocol credentials: %s", (raw) => {
    expect(() => accessTokenFromProtocols(raw)).toThrow();
  });
});
