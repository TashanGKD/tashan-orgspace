import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { OrgSpaceClient } from "@tashan/sdk";
import { createWebQueryClient } from "../../platform/data/query-client.js";
import { OkrPage } from "./okr-page.js";

afterEach(cleanup);
const organizationId = "95d5579d-a32d-4650-aec4-318ff3a55df1";
describe("OkrPage", () => {
  test("lists organization objectives and opens stable detail", async () => {
    const objectiveId = crypto.randomUUID();
    const sdk = {
      listObjectives: vi.fn().mockResolvedValue({
        items: [
          {
            id: objectiveId,
            organizationId,
            ownerAccountId: crypto.randomUUID(),
            title: "发布课程",
            cycle: "2026-Q3",
            progress: 40,
            version: 1,
            createdAt: "2026-08-29T00:00:00.000Z",
            updatedAt: "2026-08-29T00:00:00.000Z",
          },
        ],
        nextCursor: null,
      }),
      readObjective: vi.fn().mockResolvedValue({
        objective: {
          id: objectiveId,
          title: "发布课程",
          cycle: "2026-Q3",
          progress: 40,
          version: 1,
        },
        keyResults: [
          {
            id: crypto.randomUUID(),
            title: "完成发布",
            weight: 100,
            progress: 40,
            version: 1,
            formula: { type: "manual" },
          },
        ],
      }),
    } as unknown as OrgSpaceClient;
    render(
      <QueryClientProvider client={createWebQueryClient()}>
        <MemoryRouter>
          <OkrPage organizationId={organizationId} sdk={sdk} selectedObjectiveId={objectiveId} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByRole("heading", { name: "OKR", hidden: true })).toBeInTheDocument();
    expect(
      await screen.findByRole("link", { name: /发布课程.*40%/, hidden: true }),
    ).toBeInTheDocument();
    expect(await screen.findByRole("dialog", { name: "发布课程" })).toHaveTextContent("完成发布");
  });
});
