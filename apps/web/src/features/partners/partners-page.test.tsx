import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { OrgSpaceClient } from "@tashan/sdk";
import { createWebQueryClient } from "../../platform/data/query-client.js";
import { PartnersPage } from "./partners-page.js";
afterEach(cleanup);
const organizationId = "95d5579d-a32d-4650-aec4-318ff3a55df1",
  partnerId = "84ecfe2e-c11a-4a56-8735-934955bef834";
const summary = {
  id: partnerId,
  organizationId,
  ownerAccountId: crypto.randomUUID(),
  createdByAccountId: crypto.randomUUID(),
  name: "张三",
  organizationName: "某研究院",
  department: "科研处",
  jobTitle: "处长",
  phoneMasked: "+86 138****5678",
  wechatMasked: "w***x",
  emailMasked: "z***@example.com",
  addressMasked: "北京市***",
  cooperationStage: "contacting",
  tags: ["科研"],
  notes: null,
  lastContactAt: null,
  nextFollowUpAt: null,
  recordState: "active",
  version: 1,
  createdAt: "2026-08-29T00:00:00.000Z",
  updatedAt: "2026-08-29T00:00:00.000Z",
};
function renderPage(sdk: OrgSpaceClient, canManage = false, selectedPartnerId?: string) {
  return render(
    <QueryClientProvider client={createWebQueryClient()}>
      <MemoryRouter>
        <PartnersPage
          organizationId={organizationId}
          sdk={sdk}
          canManage={canManage}
          selectedPartnerId={selectedPartnerId}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
describe("PartnersPage", () => {
  test("shows masked owner list and authorized full detail", async () => {
    const sdk = {
      listPartners: vi.fn().mockResolvedValue({ items: [summary], nextCursor: null }),
      readPartner: vi.fn().mockResolvedValue({
        partner: {
          ...summary,
          phone: "+8613812345678",
          wechat: "wx",
          email: "z@example.com",
          address: "北京市海淀区",
        },
      }),
      listPartnerInteractions: vi.fn().mockResolvedValue({ items: [] }),
    } as unknown as OrgSpaceClient;
    renderPage(sdk, false, partnerId);
    expect(
      await screen.findByRole("link", { name: /张三.*联系中/, hidden: true }),
    ).toBeInTheDocument();
    expect(await screen.findByRole("dialog", { name: "张三" })).toHaveTextContent("+8613812345678");
    expect(
      screen.queryByText("13812345678", { exact: false, selector: "a" }),
    ).not.toBeInTheDocument();
    expect(sdk.listPartners).toHaveBeenCalledWith(
      organizationId,
      { owner: "self" },
      expect.anything(),
    );
  });
  test("lets administrators explicitly switch to all and awaiting owner", async () => {
    const listPartners = vi.fn().mockResolvedValue({ items: [], nextCursor: null });
    const listAwaitingPartners = vi.fn().mockResolvedValue({
      items: [{ ...summary, recordState: "awaiting_owner" }],
      nextCursor: null,
    });
    renderPage({ listPartners, listAwaitingPartners } as unknown as OrgSpaceClient, true);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "全部合作方" }));
    expect(listPartners).toHaveBeenCalledWith(organizationId, { owner: "all" }, expect.anything());
    await user.click(screen.getByRole("button", { name: "待接管" }));
    expect(listAwaitingPartners).toHaveBeenCalledWith(organizationId, expect.anything());
  });
});
