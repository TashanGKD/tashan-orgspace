import { Bell, LogOut, Menu as MenuIcon, Search } from "lucide-react";

import type { OrganizationSummary } from "@tashan/contracts";

import {
  Button,
  Menu,
  MenuContent,
  MenuItem,
  MenuTrigger,
} from "../../design-system/primitives/index.js";
import { SpaceSwitcher } from "./space-switcher.js";

export function WorkspaceHeader({
  current,
  displayName,
  onLogout,
  onOpenMobileNavigation,
  organizations,
}: {
  current: OrganizationSummary;
  displayName: string;
  onLogout(): Promise<void>;
  onOpenMobileNavigation(): void;
  organizations: readonly OrganizationSummary[];
}) {
  return (
    <header className="workspace-header">
      <Button
        aria-label="打开导航"
        className="mobile-navigation-trigger"
        size="small"
        variant="quiet"
        onClick={onOpenMobileNavigation}
      >
        <MenuIcon aria-hidden size={19} />
      </Button>
      <SpaceSwitcher current={current} organizations={organizations} />
      <button className="workspace-command-trigger" type="button">
        <Search aria-hidden size={15} />
        <span>搜索或输入命令</span>
        <kbd>⌘ K</kbd>
      </button>
      <Button aria-label="通知" className="header-icon-action" size="small" variant="quiet">
        <Bell aria-hidden size={18} />
      </Button>
      <Menu>
        <MenuTrigger asChild>
          <Button aria-label={`账户：${displayName}`} className="account-trigger" variant="quiet">
            <span aria-hidden className="member-avatar">
              {displayName.slice(0, 1)}
            </span>
            <span>{displayName}</span>
          </Button>
        </MenuTrigger>
        <MenuContent align="end">
          <MenuItem onSelect={() => void onLogout()}>
            <LogOut aria-hidden size={15} />
            退出登录
          </MenuItem>
        </MenuContent>
      </Menu>
    </header>
  );
}
