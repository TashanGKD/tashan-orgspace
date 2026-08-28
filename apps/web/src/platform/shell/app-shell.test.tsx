import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, test } from "vitest";

import { productModules } from "../modules/module-catalog.js";
import { ComingSoonPage } from "../../features/roadmap/coming-soon-page.js";
import { Navigation } from "./navigation.js";

afterEach(cleanup);

const organizationId = "95d5579d-a32d-4650-aec4-318ff3a55df1";

describe("application shell", () => {
  test("keeps the primary navigation focused and hides admin modules from members", () => {
    render(
      <MemoryRouter>
        <Navigation organizationId={organizationId} role="member" />
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: "任务" })).toBeVisible();
    expect(screen.getByRole("link", { name: "组织文件" })).toBeVisible();
    expect(screen.getByRole("link", { name: "消息" })).toBeVisible();
    const collaboration = screen.getByRole("region", { name: "组织协作" });
    expect(within(collaboration).queryByText("即将上线")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "OKR" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "成员与角色" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "操作记录" })).not.toBeInTheDocument();
  });

  test("shows administration only to an organization administrator", () => {
    render(
      <MemoryRouter>
        <Navigation organizationId={organizationId} role="org_admin" />
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: "成员与角色" })).toBeVisible();
    expect(screen.getByRole("link", { name: "操作记录" })).toBeVisible();
  });

  test("shows deferred directions in a separate future group", () => {
    render(
      <MemoryRouter>
        <Navigation organizationId={organizationId} role="member" />
      </MemoryRouter>,
    );
    const future = screen.getByRole("region", { name: "未来能力" });
    expect(within(future).getByRole("link", { name: "个人运行与构建 即将上线" })).toBeVisible();
    expect(within(future).getByRole("link", { name: "个人服务与数据库 即将上线" })).toBeVisible();
    expect(within(future).getByRole("link", { name: "运行与构建 即将上线" })).toBeVisible();
    expect(within(future).getByRole("link", { name: "服务与数据库 即将上线" })).toBeVisible();
  });

  test("coming-soon pages are inert", () => {
    const module = productModules.find((candidate) => candidate.id === "organization.tasks");
    if (module === undefined) throw new Error("task roadmap module is missing");
    render(
      <MemoryRouter>
        <ComingSoonPage module={module} backTo={`/org/${organizationId}/home`} />
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading", { name: "任务" })).toBeVisible();
    expect(screen.getByText("即将上线")).toBeVisible();
    expect(screen.getByText("此功能暂未开放")).toBeVisible();
    expect(screen.queryByText(/产品边界|服务器操作/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
  });
});
