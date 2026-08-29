import { describe, expect, test } from "vitest";

import { routes } from "./route-paths.js";

const organizationId = "95d5579d-a32d-4650-aec4-318ff3a55df1";

describe("organization route builders", () => {
  test("builds an encoded route only after validating the organization ID", () => {
    expect(routes.organizations).toBe("/organizations");
    expect(routes.organizationHome(organizationId)).toBe(`/org/${organizationId}/home`);
  });

  test("builds validated Phase 0 resource detail routes", () => {
    const accountId = "b228e557-2214-4f95-b49d-d4ff7d9759d4";
    const deviceId = "5a480f2c-eb46-4d67-948f-1c089dcfe760";
    const eventId = "6b9b7979-af04-4da6-bc92-e702ad302acb";
    const fileId = "746fb70b-a27e-4a78-a231-aa55ef8c343e";
    expect(routes.organizationMember(organizationId, accountId)).toBe(
      `/org/${organizationId}/admin/members/${accountId}`,
    );
    expect(routes.organizationAuditEvent(organizationId, eventId)).toBe(
      `/org/${organizationId}/admin/audit/${eventId}`,
    );
    expect(routes.device(deviceId)).toBe(`/account/devices/${deviceId}`);
    expect(routes.personalFile(fileId)).toBe(`/personal/files/${fileId}`);
    expect(routes.organizationFile(organizationId, fileId)).toBe(
      `/org/${organizationId}/files/${fileId}`,
    );
  });

  test.each(["../admin", "not-a-uuid", "", "95d5579d-a32d-4650-aec4-318ff3a55df1/../../x"])(
    "rejects an untrusted organization ID %s",
    (candidate) => expect(() => routes.organizationHome(candidate)).toThrow(),
  );

  test.each(["../admin", "not-a-uuid", "", `${organizationId}/../../x`])(
    "rejects an untrusted resource ID %s",
    (candidate) => {
      expect(() => routes.organizationMember(organizationId, candidate)).toThrow();
      expect(() => routes.organizationAuditEvent(organizationId, candidate)).toThrow();
      expect(() => routes.device(candidate)).toThrow();
      expect(() => routes.personalFile(candidate)).toThrow();
      expect(() => routes.organizationFile(organizationId, candidate)).toThrow();
    },
  );
});
