import { useState, type ReactNode } from "react";

import { useOrganization } from "../context/organization-context.js";
import { Navigation } from "./navigation.js";

export function AppShell({
  children,
  onLogout,
  username,
}: {
  children: ReactNode;
  onLogout(): Promise<void>;
  username: string;
}) {
  const [navigationOpen, setNavigationOpen] = useState(false);
  const organization = useOrganization();
  if (organization.status === "loading") return <p>正在加载组织…</p>;
  if (organization.status === "forbidden") return <p>无法访问该组织</p>;

  return (
    <div className="application-shell">
      <header className="application-header">
        <button
          aria-expanded={navigationOpen}
          aria-controls="workspace-sidebar"
          className="navigation-toggle"
          type="button"
          onClick={() => setNavigationOpen((current) => !current)}
        >
          菜单
        </button>
        <a className="wordmark" href="/" aria-label="他山组织空间首页">
          <span>他山</span>
          <small>ORGSPACE</small>
        </a>
        <strong>{organization.organization.name}</strong>
        <div className="member-mark">
          <strong>{username}</strong>
          <button className="text-action" type="button" onClick={() => void onLogout()}>
            退出
          </button>
        </div>
      </header>
      <aside id="workspace-sidebar" data-open={navigationOpen}>
        <Navigation organizationId={organization.organization.id} role={organization.role} />
      </aside>
      <main className="application-content">{children}</main>
    </div>
  );
}
