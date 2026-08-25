import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router";
import { afterEach, describe, expect, test, vi } from "vitest";

import type { OrgSpaceClient } from "@tashan/sdk";

import { createWebQueryClient } from "../data/query-client.js";
import {
  OrganizationProvider,
  RequireOrganizationRole,
  useOrganization,
} from "./organization-context.js";

afterEach(cleanup);

const accountId = "b228e557-2214-4f95-b49d-d4ff7d9759d4";
const organizationId = "95d5579d-a32d-4650-aec4-318ff3a55df1";
const unknownOrganizationId = "84ecfe2e-c11a-4a56-8735-934955bef834";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function sdk(role: "org_owner" | "org_admin" | "member" = "member") {
  return {
    listOrganizations: vi.fn().mockResolvedValue({
      items: [{ id: organizationId, name: "他山协会", status: "active" }],
    }),
    listMembers: vi.fn().mockResolvedValue({
      items: [{ accountId, organizationId, role, status: "active", displayName: "用户8000" }],
    }),
    listAuditEvents: vi.fn(),
  } as unknown as OrgSpaceClient;
}

function Probe() {
  const organization = useOrganization();
  if (organization.status === "loading") return <p>正在加载组织…</p>;
  if (organization.status === "forbidden") return <p>无法访问该组织</p>;
  return <h1>{organization.organization.name}</h1>;
}

function renderAt(path: string, client: OrgSpaceClient, child = <Probe />) {
  return render(
    <QueryClientProvider client={createWebQueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route
            path="/org/:organizationId/*"
            element={
              <OrganizationProvider sdk={client} accountId={accountId}>
                {child}
              </OrganizationProvider>
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("organization boundary", () => {
  test("a slower old-organization response never replaces the selected organization", async () => {
    const organizationB = unknownOrganizationId;
    const membersA = deferred<unknown>();
    const membersB = deferred<unknown>();
    const client = {
      listOrganizations: vi.fn().mockResolvedValue({
        items: [
          { id: organizationId, name: "组织 A", status: "active" },
          { id: organizationB, name: "组织 B", status: "active" },
        ],
      }),
      listMembers: vi.fn((id: string) =>
        id === organizationId ? membersA.promise : membersB.promise,
      ),
    } as unknown as OrgSpaceClient;
    function SwitchProbe() {
      const navigate = useNavigate();
      return (
        <>
          <button type="button" onClick={() => navigate(`/org/${organizationB}/home`)}>
            切换到组织 B
          </button>
          <Probe />
        </>
      );
    }
    renderAt(`/org/${organizationId}/home`, client, <SwitchProbe />);
    await userEvent.click(await screen.findByRole("button", { name: "切换到组织 B" }));
    membersB.resolve({
      items: [{ accountId, organizationId: organizationB, role: "member", status: "active" }],
    });
    expect(await screen.findByRole("heading", { name: "组织 B" })).toBeVisible();
    membersA.resolve({
      items: [{ accountId, organizationId, role: "member", status: "active" }],
    });
    await membersA.promise;
    expect(screen.getByRole("heading", { name: "组织 B" })).toBeVisible();
  });

  test("rejects an organization absent from the membership list", async () => {
    renderAt(`/org/${unknownOrganizationId}/home`, sdk());
    expect(await screen.findByText("无法访问该组织")).toBeVisible();
  });

  test("a member cannot render an admin route or start its data request", async () => {
    const client = sdk("member");
    renderAt(
      `/org/${organizationId}/admin/audit`,
      client,
      <RequireOrganizationRole roles={["org_owner", "org_admin"]}>
        <p>组织审计内容</p>
      </RequireOrganizationRole>,
    );
    expect(await screen.findByText("你没有访问此页面的权限")).toBeVisible();
    expect(screen.queryByText("组织审计内容")).not.toBeInTheDocument();
    expect(client.listAuditEvents).not.toHaveBeenCalled();
  });

  test("an administrator can cross the role boundary", async () => {
    renderAt(
      `/org/${organizationId}/admin/audit`,
      sdk("org_admin"),
      <RequireOrganizationRole roles={["org_owner", "org_admin"]}>
        <p>组织审计内容</p>
      </RequireOrganizationRole>,
    );
    expect(await screen.findByText("组织审计内容")).toBeVisible();
  });
});
