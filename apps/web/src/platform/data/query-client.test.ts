import { describe, expect, test } from "vitest";

import { OrgSpaceApiError } from "@tashan/sdk";

import { shouldRetryQuery } from "./query-client.js";

describe("query retry policy", () => {
  test.each([401, 403, 409, 429])("does not retry HTTP %s", (status) => {
    const error = new OrgSpaceApiError(
      status === 401 ? "AUTH_REQUIRED" : "ORG_FORBIDDEN",
      status,
      "rejected",
      "bb310eb3-d828-4c4b-99fa-7e0f510cdb90",
    );
    expect(shouldRetryQuery(0, error)).toBe(false);
  });

  test("retries an unknown network failure only once", () => {
    expect(shouldRetryQuery(0, new TypeError("network failed"))).toBe(true);
    expect(shouldRetryQuery(1, new TypeError("network failed"))).toBe(false);
  });
});
