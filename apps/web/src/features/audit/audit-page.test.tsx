import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import type { OrgSpaceClient } from "@tashan/sdk";

import { createWebQueryClient } from "../../platform/data/query-client.js";
import { AuditPage } from "./audit-page.js";

afterEach(cleanup);

const organizationId = "95d5579d-a32d-4650-aec4-318ff3a55df1";
const requestId = "bb310eb3-d828-4c4b-99fa-7e0f510cdb90";

test("lists organization audit actions and their request IDs", async () => {
  const sdk = {
    listAuditEvents: vi.fn().mockResolvedValue({
      items: [
        {
          id: "event-1",
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
      <AuditPage organizationId={organizationId} sdk={sdk} />
    </QueryClientProvider>,
  );
  expect(await screen.findByText("organization.create")).toBeVisible();
  expect(screen.getByText(requestId)).toBeVisible();
  expect(sdk.listAuditEvents).toHaveBeenCalledWith(
    { organizationId, limit: 25 },
    expect.any(AbortSignal),
  );
});
