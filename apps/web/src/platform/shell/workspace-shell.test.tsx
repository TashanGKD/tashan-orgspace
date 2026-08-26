import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { OrgSpaceClient } from "@tashan/sdk";

import { OrganizationProvider } from "../context/organization-context.js";
import { createWebQueryClient } from "../data/query-client.js";
import { AppShell } from "./app-shell.js";

const accountId = "b228e557-2214-4f95-b49d-d4ff7d9759d4";
const organizationA = "95d5579d-a32d-4650-aec4-318ff3a55df1";
const organizationB = "84ecfe2e-c11a-4a56-8735-934955bef834";

beforeEach(() => localStorage.clear());
afterEach(cleanup);

function client(role: "org_owner" | "org_admin" | "member" = "member") {
  return {
    listOrganizations: vi.fn().mockResolvedValue({
      items: [
        { id: organizationA, name: "他山协会", status: "active" },
        { id: organizationB, name: "研究小组", status: "active" },
      ],
    }),
    listMembers: vi.fn((organizationId: string) =>
      Promise.resolve({
        items: [
          {
            accountId,
            organizationId,
            role,
            status: "active",
            displayName: "用户8000",
          },
        ],
      }),
    ),
  } as unknown as OrgSpaceClient;
}

function LocationProbe() {
  return <output aria-label="当前路径">{useLocation().pathname}</output>;
}

function renderShell(role: "org_owner" | "org_admin" | "member" = "member") {
  return render(
    <QueryClientProvider client={createWebQueryClient()}>
      <MemoryRouter initialEntries={[`/org/${organizationA}/home`]}>
        <Routes>
          <Route
            path="/org/:organizationId/*"
            element={
              <OrganizationProvider accountId={accountId} sdk={client(role)}>
                <AppShell displayName="用户8000" onLogout={vi.fn()}>
                  <h1>组织概览</h1>
                  <LocationProbe />
                </AppShell>
              </OrganizationProvider>
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("responsive workspace shell", () => {
  test("has one authoritative desktop header rule instead of a legacy override", () => {
    const css = readFileSync(resolve(import.meta.dirname, "../../styles.css"), "utf8");
    expect(css.match(/^\.workspace-header \{/gm)).toHaveLength(1);
    expect(css).not.toContain("min-height: 5.5rem");
  });

  test("collapses explicitly and restores the device-local preference", async () => {
    const user = userEvent.setup();
    const first = renderShell();
    const aside = await screen.findByRole("complementary", { name: "工作区导航" });
    await user.click(screen.getByRole("button", { name: "折叠侧边栏" }));
    expect(aside).toHaveAttribute("data-collapsed", "true");
    expect(localStorage.getItem("orgspace.sidebar-collapsed")).toBe("1");

    first.unmount();
    renderShell();
    expect(await screen.findByRole("complementary", { name: "工作区导航" })).toHaveAttribute(
      "data-collapsed",
      "true",
    );
  });

  test("switches among the organizations returned by the server", async () => {
    const user = userEvent.setup();
    renderShell();
    await user.click(await screen.findByRole("button", { name: /当前空间.*他山协会/ }));
    await user.click(screen.getByRole("menuitem", { name: "研究小组" }));
    expect(screen.getByRole("status", { name: "当前路径" })).toHaveTextContent(
      `/org/${organizationB}/home`,
    );
  });

  test("keeps administration role-filtered and places overflow navigation in More", async () => {
    const user = userEvent.setup();
    renderShell("member");
    const desktop = await screen.findByRole("navigation", { name: "主导航" });
    expect(within(desktop).getByRole("link", { name: /任务.*即将上线/ })).toBeVisible();
    expect(within(desktop).queryByRole("link", { name: "成员与角色" })).not.toBeInTheDocument();

    const mobile = screen.getByRole("navigation", { name: "移动导航" });
    expect(mobile.querySelectorAll("a")).toHaveLength(4);
    await user.click(screen.getByRole("button", { name: "更多导航" }));
    const dialog = screen.getByRole("dialog", { name: "全部模块" });
    expect(dialog).toBeVisible();
    expect(within(dialog).getByRole("link", { name: /组织文件.*即将上线/ })).toBeVisible();
  });
});
