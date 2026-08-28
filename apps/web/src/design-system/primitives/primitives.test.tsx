import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test } from "vitest";

import { StatusBadge } from "./badge.js";
import { Button } from "./button.js";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "./menu.js";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "./sheet.js";
import { Skeleton } from "./skeleton.js";

afterEach(cleanup);

describe("OrgSpace UI primitives", () => {
  test("button exposes its accessible name and native disabled state", () => {
    render(<Button disabled>创建任务</Button>);
    expect(screen.getByRole("button", { name: "创建任务" })).toBeDisabled();
  });

  test("status badges communicate status with text instead of color alone", () => {
    render(<StatusBadge tone="warning">等待审批</StatusBadge>);
    expect(screen.getByText("等待审批")).toHaveAttribute("data-tone", "warning");
  });

  test("sheet has a named dialog and closes with Escape", async () => {
    const user = userEvent.setup();
    render(
      <Sheet>
        <SheetTrigger asChild>
          <Button>打开详情</Button>
        </SheetTrigger>
        <SheetContent>
          <SheetTitle>任务详情</SheetTitle>
          <p>详情正文</p>
        </SheetContent>
      </Sheet>,
    );
    await user.click(screen.getByRole("button", { name: "打开详情" }));
    expect(screen.getByRole("dialog", { name: "任务详情" })).toBeVisible();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "任务详情" })).not.toBeInTheDocument();
  });

  test("menu opens from the keyboard and exposes menu items", async () => {
    const user = userEvent.setup();
    render(
      <Menu>
        <MenuTrigger asChild>
          <Button>更多操作</Button>
        </MenuTrigger>
        <MenuContent>
          <MenuItem>查看审计</MenuItem>
        </MenuContent>
      </Menu>,
    );
    screen.getByRole("button", { name: "更多操作" }).focus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("menuitem", { name: "查看审计" })).toBeVisible();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menuitem", { name: "查看审计" })).not.toBeInTheDocument();
  });

  test("skeletons expose a named loading status", () => {
    render(<Skeleton label="正在加载任务" />);
    expect(screen.getByRole("status", { name: "正在加载任务" })).toBeVisible();
  });

  test("uses the reviewed homepage-v2 token contract", () => {
    const tokenPath = resolve(import.meta.dirname, "../brand-tokens.css");
    const tokenExists = existsSync(tokenPath);
    expect(tokenExists, "brand-tokens.css").toBe(true);
    if (!tokenExists) return;

    const css = readFileSync(tokenPath, "utf8");
    expect(css).toContain("--brand-navy: #0e2e4f");
    expect(css).toContain("--brand-blue: #5b9bd5");
    expect(css).toContain("--brand-mint: #9fd4c4");
    expect(css).toContain("--radius-card: 20px");
    expect(css).toContain("--shadow-card: 0 4px 16px rgba(15, 46, 79, 0.12)");
    expect(css).not.toMatch(/--ink:|--paper:|--red:/);
  });

  test("keeps global accessibility rules separate from component styles", () => {
    const globalPath = resolve(import.meta.dirname, "../global.css");
    const globalExists = existsSync(globalPath);
    expect(globalExists, "global.css").toBe(true);
    if (!globalExists) return;

    const css = readFileSync(globalPath, "utf8");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain("font-variant-numeric: tabular-nums");
    expect(css).not.toMatch(/Noto Serif CJK SC|Songti SC|STSong/);
  });
});
