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

test("lists organization audit actions in user language", async () => {
  const sdk = {
    listAuditEvents: vi.fn().mockResolvedValue({
      items: [
        {
          id: eventId,
          capabilityId: "organization.member.add",
          action: "organization.member.add",
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
  expect(await screen.findByRole("heading", { name: "操作记录" })).toBeVisible();
  expect(screen.getByText("添加组织成员")).toBeVisible();
  expect(screen.getByText("网页")).toBeVisible();
  expect(screen.queryByText(requestId)).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: /添加组织成员.*成功/ })).toHaveAttribute(
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
  expect(await screen.findByRole("heading", { name: "创建组织" })).toBeVisible();
  expect(screen.getByText("organization.create")).toBeVisible();
  expect(screen.getByText(requestId)).toBeVisible();
  expect(screen.getByText("203.0.113.10")).toBeVisible();
  expect(screen.getByText("部分敏感信息已隐藏")).toBeVisible();
  expect(screen.queryByText("must-not-render")).not.toBeInTheDocument();
});

test("follows audit pagination when a copied detail URL points beyond the first page", async () => {
  const olderEventId = "f27afaa3-858f-46f5-b01a-4c702b5ce1c6";
  const event = {
    id: olderEventId,
    capabilityId: "organization.member.add",
    result: "success",
    requestId,
    actorSource: "web",
    occurredAt: "2026-08-18T00:00:00.000Z",
    objectType: "membership",
    objectId: "membership-1",
    serverIp: "203.0.113.10",
    device: null,
  };
  const sdk = {
    listAuditEvents: vi
      .fn()
      .mockResolvedValueOnce({ items: [], nextCursor: "older-page" })
      .mockResolvedValueOnce({ items: [event], nextCursor: null }),
  } as unknown as OrgSpaceClient;
  render(
    <QueryClientProvider client={createWebQueryClient()}>
      <MemoryRouter>
        <AuditPage organizationId={organizationId} sdk={sdk} selectedEventId={olderEventId} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(await screen.findByRole("heading", { name: "添加组织成员" })).toBeVisible();
  expect(screen.getByText("organization.member.add")).toBeVisible();
  expect(sdk.listAuditEvents).toHaveBeenNthCalledWith(
    1,
    { organizationId, limit: 100 },
    expect.any(AbortSignal),
  );
  expect(sdk.listAuditEvents).toHaveBeenNthCalledWith(
    2,
    { organizationId, limit: 100, cursor: "older-page" },
    expect.any(AbortSignal),
  );
});

test("stops safely when audit pagination repeats a cursor", async () => {
  const missingEventId = "de9b9ba8-2f33-4f76-a749-59be28bd4df7";
  const sdk = {
    listAuditEvents: vi
      .fn()
      .mockResolvedValueOnce({ items: [], nextCursor: "repeated" })
      .mockResolvedValueOnce({ items: [], nextCursor: "repeated" }),
  } as unknown as OrgSpaceClient;
  render(
    <QueryClientProvider client={createWebQueryClient()}>
      <MemoryRouter>
        <AuditPage organizationId={organizationId} sdk={sdk} selectedEventId={missingEventId} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(await screen.findByText("审计记录加载失败")).toBeVisible();
  expect(sdk.listAuditEvents).toHaveBeenCalledTimes(2);
});

test("shows a stable not-found state after the final audit page", async () => {
  const missingEventId = "de9b9ba8-2f33-4f76-a749-59be28bd4df7";
  const sdk = {
    listAuditEvents: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
  } as unknown as OrgSpaceClient;
  render(
    <QueryClientProvider client={createWebQueryClient()}>
      <MemoryRouter>
        <AuditPage organizationId={organizationId} sdk={sdk} selectedEventId={missingEventId} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(await screen.findByText("审计记录加载失败")).toBeVisible();
  expect(sdk.listAuditEvents).toHaveBeenCalledTimes(1);
});
