import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { OrgSpaceClient } from "@tashan/sdk";
import { createWebQueryClient } from "../../platform/data/query-client.js";
import { WorkPage } from "./work-page.js";

afterEach(cleanup);
const organizationId = "95d5579d-a32d-4650-aec4-318ff3a55df1";
function renderPage(sdk: OrgSpaceClient, type: "task" | "meeting" | "approval" = "task") {
  return render(
    <QueryClientProvider client={createWebQueryClient()}>
      <MemoryRouter>
        <WorkPage organizationId={organizationId} sdk={sdk} type={type} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
describe("WorkPage", () => {
  test("uses one list-detail surface for typed organization work", async () => {
    const sdk = {
      listWorkItems: vi.fn().mockResolvedValue({
        items: [
          {
            id: crypto.randomUUID(),
            organizationId,
            type: "task",
            title: "准备议程",
            description: "",
            priority: "normal",
            status: "open",
            dueAt: null,
            meetingStartsAt: null,
            createdByAccountId: crypto.randomUUID(),
            version: 1,
            createdAt: "2026-08-29T00:00:00.000Z",
            updatedAt: "2026-08-29T00:00:00.000Z",
          },
        ],
        nextCursor: null,
      }),
    } as unknown as OrgSpaceClient;
    renderPage(sdk);
    expect(await screen.findByRole("heading", { name: "任务" })).toBeVisible();
    expect(await screen.findByRole("link", { name: /准备议程.*进行中/ })).toBeVisible();
    expect(sdk.listWorkItems).toHaveBeenCalledWith(
      organizationId,
      { type: "task" },
      expect.anything(),
    );
  });
  test("creates a typed item from a separate dialog", async () => {
    const createTask = vi
      .fn()
      .mockResolvedValue({ item: { id: crypto.randomUUID(), title: "新任务" }, assignments: [] });
    const sdk = {
      listWorkItems: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
      createTask,
    } as unknown as OrgSpaceClient;
    renderPage(sdk);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "新建任务" }));
    await user.type(screen.getByLabelText("标题"), "新任务");
    await user.click(screen.getByRole("button", { name: "创建任务" }));
    expect(createTask).toHaveBeenCalledWith(
      organizationId,
      expect.objectContaining({ title: "新任务" }),
      expect.objectContaining({ idempotencyKey: expect.stringMatching(/^web-work-/) }),
    );
  });
});
