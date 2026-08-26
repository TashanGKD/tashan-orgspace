import { PanelLeftClose, PanelLeftOpen } from "lucide-react";

import { Button } from "../../design-system/primitives/index.js";
import type { MembershipRole } from "../context/organization-context.js";
import { Navigation } from "./navigation.js";

export function Sidebar({
  collapsed,
  displayName,
  onCollapsedChange,
  organizationId,
  role,
}: {
  collapsed: boolean;
  displayName: string;
  onCollapsedChange(collapsed: boolean): void;
  organizationId: string;
  role: MembershipRole;
}) {
  return (
    <aside aria-label="工作区导航" className="workspace-sidebar" data-collapsed={String(collapsed)}>
      <div className="workspace-sidebar-brand">
        <a aria-label="他山组织空间首页" className="workspace-wordmark" href="/">
          <span>他山</span>
          {collapsed ? null : <small>ORGSPACE</small>}
        </a>
        <Button
          aria-label={collapsed ? "展开侧边栏" : "折叠侧边栏"}
          className="sidebar-collapse"
          size="small"
          variant="quiet"
          onClick={() => onCollapsedChange(!collapsed)}
        >
          {collapsed ? (
            <PanelLeftOpen aria-hidden size={17} />
          ) : (
            <PanelLeftClose aria-hidden size={17} />
          )}
        </Button>
      </div>
      <Navigation collapsed={collapsed} organizationId={organizationId} role={role} />
      <div className="workspace-sidebar-member" title={displayName}>
        <span aria-hidden className="member-avatar">
          {displayName.slice(0, 1)}
        </span>
        {collapsed ? null : <span>{displayName}</span>}
      </div>
    </aside>
  );
}
