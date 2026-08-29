import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { OrgSpaceClient } from "@tashan/sdk";
import { createWebQueryClient } from "../../platform/data/query-client.js";
import { MyWorkPage } from "./my-work-page.js";

afterEach(cleanup);
describe("MyWorkPage", () => {
  test("shows cross-organization references and filters by kind", async () => {
    const listMyWork = vi.fn().mockImplementation((input: { kind?: string }) =>
      Promise.resolve({
        items:
          input.kind === "meeting"
            ? []
            : [
                {
                  id: "work:1",
                  kind: "task",
                  organizationName: "组织 A",
                  title: "整理议程",
                  dueAt: null,
                  href: "/org/00000000-0000-4000-8000-000000000001/tasks/00000000-0000-4000-8000-000000000002",
                  status: "open",
                },
              ],
      }),
    );
    render(
      <QueryClientProvider client={createWebQueryClient()}>
        <MemoryRouter>
          <MyWorkPage sdk={{ listMyWork } as unknown as OrgSpaceClient} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByRole("link", { name: "整理议程 任务" })).toHaveAttribute(
      "href",
      expect.stringContaining("/org/"),
    );
    await userEvent.click(screen.getByRole("button", { name: "会议" }));
    expect(listMyWork).toHaveBeenCalledWith({ kind: "meeting" }, expect.anything());
  });
});
