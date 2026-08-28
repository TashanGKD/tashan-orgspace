import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";

import { Button } from "../../design-system/primitives/index.js";
import { PageHero } from "./page-hero.js";

afterEach(cleanup);

describe("PageHero", () => {
  test("renders one page title with optional description and action", () => {
    render(
      <PageHero action={<Button>添加成员</Button>} description="查看和添加组织成员" title="成员" />,
    );

    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "成员" })).toBeVisible();
    expect(screen.getByText("查看和添加组织成员")).toBeVisible();
    expect(screen.getByRole("button", { name: "添加成员" })).toBeVisible();
  });

  test("detail drawer cards keep their content height instead of stretching", () => {
    const css = readFileSync(
      resolve(import.meta.dirname, "../../design-system/resource-surfaces.css"),
      "utf8",
    );
    expect(css).toMatch(
      /\.resource-detail-drawer-body\s*\{[^}]*align-content:\s*start;[^}]*grid-auto-rows:\s*max-content;/s,
    );
    expect(css).toContain("width: min(100%, 480px)");
    expect(css).toContain("@media (max-width: 760px)");
  });
});
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
