import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, expect, test, vi } from "vitest";

import type { OrgSpaceClient } from "@tashan/sdk";

import { createWebQueryClient } from "../../platform/data/query-client.js";
import { AuditPage } from "./audit-page.js";

afterEach(cleanup);

const organizationId = "95d5579d-a32d-4650-aec4-318ff3a55df1";
const requestId = "bb310eb3-d828-4c4b-99fa-7e0f510cdb90";
const eventId = "6b9b7979-af04-4da6-bc92-e702ad302acb";

test("lists organization audit actions and their request IDs", async () => {
  const sdk = {
    listAuditEvents: vi.fn().mockResolvedValue({
      items: [
        {
          id: eventId,
          capabilityId: "organization.create",
          action: "organization.create",
          result: "success",
          requestId,
          actorSource: "web",
          occurredAt: "2026-08-19T00:00:00.000Z",
        },
      ],
      nextCursor: null,
    }),
  } as unknown as OrgSpaceClient;
  render(
    <QueryClientProvider client={createWebQueryClient()}>
      <MemoryRouter>
        <AuditPage organizationId={organizationId} sdk={sdk} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(await screen.findByText("organization.create")).toBeVisible();
  expect(screen.getByText(requestId)).toBeVisible();
  expect(screen.getByRole("link", { name: /organization.create.*成功/ })).toHaveAttribute(
    "href",
    `/org/${organizationId}/admin/audit/${eventId}`,
  );
  expect(sdk.listAuditEvents).toHaveBeenCalledWith(
    { organizationId, limit: 25 },
    expect.any(AbortSignal),
  );
});

test("renders an audit detail without exposing raw before-after payloads", async () => {
  const sdk = {
    listAuditEvents: vi.fn().mockResolvedValue({
      items: [
        {
          id: eventId,
          capabilityId: "organization.create",
          result: "success",
          requestId,
          actorSource: "web",
          occurredAt: "2026-08-19T00:00:00.000Z",
          objectType: "organization",
          objectId: organizationId,
          serverIp: "203.0.113.10",
          device: {
            name: "MacBook Air",
            os: "macOS",
            architecture: "arm64",
            clientVersion: "0.1.0-alpha.3",
          },
          before: { passwordHash: "must-not-render" },
          after: { name: "他山协会" },
        },
      ],
      nextCursor: null,
    }),
  } as unknown as OrgSpaceClient;
  render(
    <QueryClientProvider client={createWebQueryClient()}>
      <MemoryRouter>
        <AuditPage organizationId={organizationId} sdk={sdk} selectedEventId={eventId} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(await screen.findByRole("heading", { name: "organization.create" })).toBeVisible();
  expect(screen.getByText("203.0.113.10")).toBeVisible();
  expect(screen.getByText(/敏感字段只展示服务端脱敏后的审计摘要/)).toBeVisible();
  expect(screen.queryByText("must-not-render")).not.toBeInTheDocument();
});
