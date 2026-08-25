import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";

import type { OrgSpaceClient } from "@tashan/sdk";

import { createWebQueryClient } from "../../platform/data/query-client.js";
import { MembersPage } from "./members-page.js";

afterEach(cleanup);

const organizationId = "95d5579d-a32d-4650-aec4-318ff3a55df1";
const accountId = "b228e557-2214-4f95-b49d-d4ff7d9759d4";
const targetAccountId = "84ecfe2e-c11a-4a56-8735-934955bef834";

function renderPage(sdk: OrgSpaceClient, canManage = true) {
  return render(
    <QueryClientProvider client={createWebQueryClient()}>
      <MembersPage organizationId={organizationId} sdk={sdk} canManage={canManage} />
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
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("账号 ID"), targetAccountId);
    await user.selectOptions(screen.getByLabelText("组织角色"), "member");
    await user.click(screen.getByRole("button", { name: "添加成员" }));
    expect(sdk.addMember).toHaveBeenCalledWith(
      organizationId,
      { accountId: targetAccountId, role: "member" },
      expect.objectContaining({ idempotencyKey: expect.stringMatching(/^web-member-add-/) }),
    );
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
});
