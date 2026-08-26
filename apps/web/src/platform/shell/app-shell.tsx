import { MotionConfig, motion } from "framer-motion";
import { useState, type ReactNode } from "react";
import { useLocation } from "react-router";

import { useOrganization } from "../context/organization-context.js";
import { MobileNavigation } from "./mobile-navigation.js";
import { readSidebarCollapsed, writeSidebarCollapsed } from "./shell-state.js";
import { Sidebar } from "./sidebar.js";
import { WorkspaceHeader } from "./workspace-header.js";

export function AppShell({
  children,
  onLogout,
  displayName,
}: {
  children: ReactNode;
  onLogout(): Promise<void>;
  displayName: string;
}) {
  const [collapsed, setCollapsed] = useState(readSidebarCollapsed);
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  const organization = useOrganization();
  const location = useLocation();
  if (organization.status === "loading") return <p>正在加载组织…</p>;
  if (organization.status === "forbidden") return <p>无法访问该组织</p>;

  function updateCollapsed(next: boolean): void {
    writeSidebarCollapsed(next);
    setCollapsed(next);
  }

  return (
    <MotionConfig reducedMotion="user">
      <div className="workspace-shell" data-collapsed={String(collapsed)}>
        <Sidebar
          collapsed={collapsed}
          displayName={displayName}
          organizationId={organization.organization.id}
          role={organization.role}
          onCollapsedChange={updateCollapsed}
        />
        <div className="workspace-main-frame">
          <WorkspaceHeader
            current={organization.organization}
            displayName={displayName}
            organizations={organization.organizations}
            onLogout={onLogout}
            onOpenMobileNavigation={() => setMobileNavigationOpen(true)}
          />
          <main className="workspace-content">
            <motion.div
              key={location.pathname}
              animate={{ opacity: 1, y: 0 }}
              initial={false}
              transition={{ duration: 0.18, ease: "easeOut" }}
            >
              {children}
            </motion.div>
          </main>
          <MobileNavigation
            open={mobileNavigationOpen}
            organizationId={organization.organization.id}
            role={organization.role}
            onOpenChange={setMobileNavigationOpen}
          />
        </div>
      </div>
    </MotionConfig>
  );
}
