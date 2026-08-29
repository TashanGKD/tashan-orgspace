import { describe, expect, test } from "vitest";

import {
  ActivityEvent,
  CollaborationComment,
  DomainEvent,
  ResourceLink,
  ResourceRef,
} from "./collaboration.js";

const organizationId = "35f503c2-a5d7-4250-a337-4f4fd03cf8df";
const accountId = "84ecfe2e-c11a-4a56-8735-934955bef834";
const resourceId = "746fb70b-a27e-4a78-a231-aa55ef8c343e";
const otherResourceId = "b228e557-2214-4f95-b49d-d4ff7d9759d4";
const createdAt = "2026-08-29T06:00:00.000Z";

describe("collaboration contracts", () => {
  test("accepts stable resource, link, comment and event envelopes", () => {
    const source = ResourceRef.parse({ organizationId, resourceType: "file", resourceId });
    const target = ResourceRef.parse({
      organizationId,
      resourceType: "work_item",
      resourceId: otherResourceId,
    });
    expect(
      ResourceLink.parse({
        id: crypto.randomUUID(),
        organizationId,
        source,
        target,
        relationType: "attachment",
        createdByAccountId: accountId,
        createdAt,
      }),
    ).toMatchObject({ relationType: "attachment" });
    expect(
      CollaborationComment.parse({
        id: crypto.randomUUID(),
        organizationId,
        resource: source,
        body: "Please review",
        authorAccountId: accountId,
        createdAt,
        updatedAt: createdAt,
      }),
    ).toMatchObject({ body: "Please review" });
    expect(
      ActivityEvent.parse({
        id: crypto.randomUUID(),
        organizationId,
        resource: source,
        eventType: "comment.created",
        schemaVersion: 1,
        actorAccountId: accountId,
        payload: { commentId: crypto.randomUUID() },
        createdAt,
      }),
    ).toMatchObject({ schemaVersion: 1 });
    expect(
      DomainEvent.parse({
        id: crypto.randomUUID(),
        organizationId,
        aggregate: target,
        sequence: 1,
        eventType: "work.created",
        schemaVersion: 1,
        actorAccountId: accountId,
        payload: { title: "Draft agenda" },
        createdAt,
      }),
    ).toMatchObject({ sequence: 1 });
  });

  test.each([
    { resourceType: "../../secret", resourceId },
    { resourceType: "file", resourceId: "not-a-uuid" },
    { resourceType: "unknown", resourceId },
  ])("rejects forged resource references %#", (candidate) => {
    expect(() => ResourceRef.parse({ organizationId, ...candidate })).toThrow();
  });

  test("rejects zero schema versions and non-object payloads", () => {
    expect(() =>
      DomainEvent.parse({
        id: crypto.randomUUID(),
        organizationId,
        aggregate: { organizationId, resourceType: "work_item", resourceId },
        sequence: 1,
        eventType: "work.created",
        schemaVersion: 0,
        actorAccountId: accountId,
        payload: [],
        createdAt,
      }),
    ).toThrow();
  });
});
