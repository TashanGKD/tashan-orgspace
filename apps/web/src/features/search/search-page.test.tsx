import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { OrgSpaceClient } from "@tashan/sdk";
import { createWebQueryClient } from "../../platform/data/query-client.js";
import { SearchPage } from "./search-page.js";

afterEach(cleanup);
describe("SearchPage", () => {
  test("renders only the authorized hits returned by the API", async () => {
    const searchOrganization = vi.fn().mockResolvedValue({
      totalAuthorized: 1,
      groups: [
        {
          type: "file",
          items: [
            {
              type: "file",
              title: "会议资料",
              snippet: "会议资料",
              href: "/org/o/files/f",
              resource: { resourceId: "f" },
            },
          ],
        },
      ],
    });
    render(
      <QueryClientProvider client={createWebQueryClient()}>
        <MemoryRouter>
          <SearchPage
            organizationId="00000000-0000-4000-8000-000000000001"
            sdk={{ searchOrganization } as unknown as OrgSpaceClient}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await userEvent.type(screen.getByLabelText("搜索内容"), "会议");
    await userEvent.click(screen.getByRole("button", { name: "搜索" }));
    expect(await screen.findByRole("link", { name: "会议资料 文件" })).toBeInTheDocument();
    expect(searchOrganization).toHaveBeenCalledWith(
      expect.any(String),
      { query: "会议" },
      expect.anything(),
    );
  });
});
