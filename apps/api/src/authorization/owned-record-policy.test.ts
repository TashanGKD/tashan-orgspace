import { describe, expect, test } from "vitest";
import {
  OwnedOrganizationRecordPolicy,
  OwnedRecordUnavailableError,
} from "./owned-record-policy.js";

describe("owned organization record policy", () => {
  const policy = new OwnedOrganizationRecordPolicy();
  const record = { organizationId: "org-a", ownerAccountId: "owner" };
  test("allows owner and organization administrators", () => {
    expect(
      policy.requireAccess({ accountId: "owner", organizationId: "org-a", role: "member" }, record),
    ).toBe("owner");
    expect(
      policy.requireAccess(
        { accountId: "admin", organizationId: "org-a", role: "org_admin" },
        record,
      ),
    ).toBe("administrator");
    expect(
      policy.requireAccess(
        { accountId: "root", organizationId: "org-a", role: "org_owner" },
        record,
      ),
    ).toBe("administrator");
  });
  test.each([
    { accountId: "other", organizationId: "org-a", role: "member" as const },
    { accountId: "owner", organizationId: "org-b", role: "member" as const },
    { accountId: "owner", organizationId: "org-a", role: "member" as const, active: false },
  ])("returns the same non-inferable error for unavailable records %#", (actor) => {
    expect(() => policy.requireAccess(actor, record)).toThrow(OwnedRecordUnavailableError);
  });
});
