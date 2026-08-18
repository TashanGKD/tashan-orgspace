import { describe, expect, test } from "vitest";

import { routes } from "./route-paths.js";

const organizationId = "95d5579d-a32d-4650-aec4-318ff3a55df1";

describe("organization route builders", () => {
  test("builds an encoded route only after validating the organization ID", () => {
    expect(routes.organizationHome(organizationId)).toBe(`/org/${organizationId}/home`);
  });

  test.each(["../admin", "not-a-uuid", "", "95d5579d-a32d-4650-aec4-318ff3a55df1/../../x"])(
    "rejects an untrusted organization ID %s",
    (candidate) => expect(() => routes.organizationHome(candidate)).toThrow(),
  );
});
