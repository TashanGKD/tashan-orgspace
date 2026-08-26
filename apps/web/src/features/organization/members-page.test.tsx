import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, test, vi } from "vitest";

import type { OrgSpaceClient } from "@tashan/sdk";

import { createWebQueryClient } from "../../platform/data/query-client.js";
import { MembersPage } from "./members-page.js";

afterEach(cleanup);

const organizationId = "95d5579d-a32d-4650-aec4-318ff3a55df1";
const accountId = "b228e557-2214-4f95-b49d-d4ff7d9759d4";
const targetAccountId = "84ecfe2e-c11a-4a56-8735-934955bef834";

function renderPage(sdk: OrgSpaceClient, canManage = true, selectedAccountId?: string) {
  return render(
    <QueryClientProvider client={createWebQueryClient()}>
      <MemoryRouter>
        <MembersPage
          canManage={canManage}
          organizationId={organizationId}
          sdk={sdk}
          selectedAccountId={selectedAccountId}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("MembersPage", () => {
  test("lists members and adds one with an idempotency key", async () => {
    const sdk = {
      listMembers: vi.fn().mockResolvedValue({
        items: [{ accountId, displayName: "用户8000", role: "org_admin", status: "active" }],
      }),
      addMember: vi.fn().mockResolvedValue({
        membership: {
          accountId: targetAccountId,
          displayName: "用户8001",
          role: "member",
          status: "active",
        },
      }),
    } as unknown as OrgSpaceClient;
    renderPage(sdk);
    expect(await screen.findByText("用户8000")).toBeVisible();
    expect(screen.getByText("查看和添加组织成员")).toBeVisible();
    expect(screen.queryByText(accountId)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /用户8000.*正常/ })).toHaveAttribute(
      "href",
      `/org/${organizationId}/admin/members/${accountId}`,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "网格视图" }));
    expect(screen.getByRole("heading", { name: "成员与角色" }).closest("section")).toHaveAttribute(
      "data-view",
      "grid",
    );
    await user.type(screen.getByLabelText("账号 ID"), targetAccountId);
    await user.selectOptions(screen.getByLabelText("组织角色"), "member");
    await user.click(screen.getByRole("button", { name: "添加成员" }));
    expect(sdk.addMember).toHaveBeenCalledWith(
      organizationId,
      { accountId: targetAccountId, role: "member" },
      expect.objectContaining({ idempotencyKey: expect.stringMatching(/^web-member-add-/) }),
    );
  });

  test("renders a stable member detail from the list response", async () => {
    const sdk = {
      listMembers: vi.fn().mockResolvedValue({
        items: [
          {
            accountId,
            displayName: "用户8000",
            role: "org_admin",
            status: "active",
            createdAt: "2026-08-19T00:00:00.000Z",
            updatedAt: "2026-08-20T00:00:00.000Z",
          },
        ],
      }),
      addMember: vi.fn(),
    } as unknown as OrgSpaceClient;
    renderPage(sdk, true, accountId);
    expect(await screen.findByRole("heading", { name: "用户8000" })).toBeVisible();
    expect(screen.getByText(accountId)).toBeVisible();
    expect(screen.getByText("组织管理员")).toBeVisible();
    expect(screen.getByText("2026-08-20T00:00:00.000Z")).toBeVisible();
  });

  test("does not render the add-member form without management permission", async () => {
    const sdk = {
      listMembers: vi.fn().mockResolvedValue({ items: [] }),
      addMember: vi.fn(),
    } as unknown as OrgSpaceClient;
    renderPage(sdk, false);
    await screen.findByRole("heading", { name: "成员与角色" });
    expect(screen.queryByLabelText("账号 ID")).not.toBeInTheDocument();
    expect(sdk.addMember).not.toHaveBeenCalled();
  });

  test("locks duplicate member submissions before React can rerender pending state", async () => {
    const sdk = {
      listMembers: vi.fn().mockResolvedValue({ items: [] }),
      addMember: vi.fn().mockImplementation(() => new Promise(() => undefined)),
    } as unknown as OrgSpaceClient;
    renderPage(sdk);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("账号 ID"), targetAccountId);
    const form = screen.getByLabelText("账号 ID").closest("form");
    if (form === null) throw new Error("member form missing");
    fireEvent.submit(form);
    fireEvent.submit(form);
    await waitFor(() => expect(sdk.addMember).toHaveBeenCalledTimes(1));
  });
});
