import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, test, vi } from "vitest";

import { ResourceActionBar } from "./resource-action-bar.js";
import { ResourceDetailDrawer } from "./resource-detail-drawer.js";
import { ResourceListToolbar } from "./resource-list-toolbar.js";
import { ResourceRow } from "./resource-row.js";
import { ResourceState } from "./resource-states.js";

afterEach(cleanup);

describe("generic resource surfaces", () => {
  test.each([
    ["loading", "正在加载成员"],
    ["empty", "还没有成员"],
    ["partial-error", "部分成员暂时无法加载"],
    ["fatal-error", "成员加载失败"],
    ["forbidden", "无权查看成员"],
    ["readonly", "成员当前为只读"],
    ["version-conflict", "成员已被其他人更新"],
  ] as const)("renders the %s state with explicit text", (state, expected) => {
    render(<ResourceState resourceLabel="成员" state={state} />);
    expect(screen.getByText(expected)).toBeVisible();
  });

  test("only interactive rows enter the keyboard tab order", () => {
    render(
      <MemoryRouter>
        <ResourceRow
          href="/org/demo/members/member-1"
          metadata={["管理员", "189****7794"]}
          status={{ label: "正常", tone: "success" }}
          title="张三"
        />
        <ResourceRow
          metadata={["系统记录"]}
          status={{ label: "只读", tone: "neutral" }}
          title="历史成员"
        />
      </MemoryRouter>,
    );

    expect(screen.getByRole("link", { name: /张三.*正常/ })).toHaveAttribute(
      "href",
      "/org/demo/members/member-1",
    );
    const readonlyRow = screen.getByText("历史成员").closest("article");
    expect(readonlyRow).not.toHaveAttribute("tabindex");
    expect(within(readonlyRow as HTMLElement).queryByRole("link")).not.toBeInTheDocument();
    expect(within(readonlyRow as HTMLElement).queryByRole("button")).not.toBeInTheDocument();
  });

  test("keeps list context while a focus-trapped detail drawer is open", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <p>成员列表仍在这里</p>
        <ResourceDetailDrawer
          fullPageHref="/org/demo/members/member-1"
          onOpenChange={vi.fn()}
          open
          title="张三"
        >
          <button type="button">编辑成员</button>
          <button type="button">查看日志</button>
        </ResourceDetailDrawer>
      </MemoryRouter>,
    );

    expect(screen.getByText("成员列表仍在这里")).toBeInTheDocument();
    const dialog = screen.getByRole("dialog", { name: "张三" });
    expect(dialog).toBeVisible();
    expect(within(dialog).getByRole("link", { name: "打开完整详情" })).toHaveAttribute(
      "href",
      "/org/demo/members/member-1",
    );
    await user.tab();
    expect(dialog).toContainElement(document.activeElement as HTMLElement | null);
  });

  test("exposes search, filter chips and a named list-grid view choice", async () => {
    const user = userEvent.setup();
    const onQueryChange = vi.fn();
    const onViewChange = vi.fn();
    function ToolbarHarness() {
      const [query, setQuery] = useState("");
      return (
        <ResourceListToolbar
          activeFilter="active"
          filters={[
            { id: "all", label: "全部" },
            { id: "active", label: "正常" },
          ]}
          onFilterChange={vi.fn()}
          onQueryChange={(next) => {
            setQuery(next);
            onQueryChange(next);
          }}
          onViewChange={onViewChange}
          query={query}
          resourceLabel="成员"
          view="list"
        />
      );
    }
    render(<ToolbarHarness />);

    await user.type(screen.getByRole("searchbox", { name: "搜索成员" }), "张三");
    expect(onQueryChange).toHaveBeenLastCalledWith("张三");
    expect(screen.getByRole("button", { name: "正常" })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "网格视图" }));
    expect(onViewChange).toHaveBeenCalledWith("grid");
  });

  test("action presentation respects readonly and version-conflict states", () => {
    render(
      <ResourceActionBar
        actions={[
          { id: "member.update", label: "保存", onAction: vi.fn() },
          { id: "member.remove", label: "移除", onAction: vi.fn(), tone: "danger" },
        ]}
        mode="readonly"
      />,
    );
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "移除" })).toBeDisabled();

    cleanup();
    render(<ResourceActionBar actions={[]} mode="version-conflict" />);
    expect(screen.getByRole("alert")).toHaveTextContent("内容已经更新，请刷新后再操作");
  });
});
