import { describe, expect, test } from "vitest";

import { resetTestDatabase } from "./migrate.js";

describe("test database reset safety boundary", () => {
  test.each([
    ["remote host", "postgresql://user:pass@db.example.com/orgspace_test", /loopback/],
    ["production-like name", "postgresql://user:pass@127.0.0.1/orgspace", /end in _test/],
    [
      "encoded identifier injection",
      "postgresql://user:pass@127.0.0.1/orgspace_test%22%3Bdrop%20database%20postgres%3B--",
      /safe characters/,
    ],
    ["userinfo host confusion", "postgresql://127.0.0.1@db.example.com/orgspace_test", /loopback/],
    ["IPv4-mapped IPv6", "postgresql://user:pass@[::ffff:127.0.0.1]/orgspace_test", /loopback/],
  ])("rejects %s before opening a connection", async (_name, url, error) => {
    await expect(resetTestDatabase(url)).rejects.toThrow(error);
  });
});
