import { describe, expect, test } from "vitest";

import { resolveWebApiOrigin } from "./api.js";

describe("resolveWebApiOrigin", () => {
  test("production composition uses the browser origin", () => {
    expect(resolveWebApiOrigin({ origin: "https://orgspace.tashan.chat" })).toBe(
      "https://orgspace.tashan.chat",
    );
  });

  test("allows an explicit local HTTP origin for isolated development", () => {
    expect(
      resolveWebApiOrigin({
        origin: "http://127.0.0.1:5173",
        override: "http://127.0.0.1:4110",
      }),
    ).toBe("http://127.0.0.1:4110");
  });

  test.each([
    "https://u:p@example.com",
    "https://example.com/v1",
    "https://example.com/?debug=1",
    "https://example.com/#fragment",
    "file:///tmp/api",
    "not a URL",
  ])("rejects unsafe API origin %s", (override) => {
    expect(() => resolveWebApiOrigin({ origin: "https://orgspace.tashan.chat", override })).toThrow(
      /HTTP\(S\) origin/,
    );
  });
});
