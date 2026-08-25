import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, test } from "vitest";

import { productModules } from "../modules/module-catalog.js";
import { ComingSoonPage } from "../../features/roadmap/coming-soon-page.js";
import { Navigation } from "./navigation.js";

afterEach(cleanup);

const organizationId = "95d5579d-a32d-4650-aec4-318ff3a55df1";

describe("application shell", () => {
  test("shows the complete roadmap but hides admin modules from members", () => {
    render(
      <MemoryRouter>
        <Navigation organizationId={organizationId} role="member" />
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: /任务.*即将上线/ })).toBeVisible();
    expect(screen.queryByRole("link", { name: "成员与角色" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "组织审计" })).not.toBeInTheDocument();
  });

  test("shows administration only to an organization administrator", () => {
    render(
      <MemoryRouter>
        <Navigation organizationId={organizationId} role="org_admin" />
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: "成员与角色" })).toBeVisible();
    expect(screen.getByRole("link", { name: "组织审计" })).toBeVisible();
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
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
  });
});
