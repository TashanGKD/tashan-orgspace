import {
  Blocks,
  Building2,
  CalendarDays,
  CircleUserRound,
  ClipboardCheck,
  FileText,
  FolderOpen,
  Gauge,
  HardDrive,
  ListTodo,
  MessageCircle,
  ScrollText,
  Server,
  Settings2,
  Target,
  Users,
  type LucideIcon,
} from "lucide-react";
import { NavLink } from "react-router";

import { OrganizationId } from "@tashan/contracts";

import { productModules, type ProductModule } from "../modules/module-catalog.js";

type MembershipRole = "org_owner" | "org_admin" | "member";

const moduleIcons: Readonly<Record<string, LucideIcon>> = {
  "global.my-work": ClipboardCheck,
  "global.account": CircleUserRound,
  "personal.overview": Gauge,
  "personal.files": FolderOpen,
  "personal.runtime": Blocks,
  "personal.services": Server,
  "personal.usage": HardDrive,
  "organization.home": Building2,
  "organization.tasks": ListTodo,
  "organization.okr": Target,
  "organization.approvals": ClipboardCheck,
  "organization.meetings": CalendarDays,
  "organization.files": FolderOpen,
  "organization.messages": MessageCircle,
  "organization.runtime": Blocks,
  "organization.services": Server,
  "organization.members": Users,
  "organization.audit": ScrollText,
  "organization.policies": Settings2,
};

export function moduleHref(module: ProductModule, organizationId: string): string {
  if (module.context !== "organization") return module.route;
  return module.route.replace(
    ":organizationId",
    encodeURIComponent(OrganizationId.parse(organizationId)),
  );
}

function ModuleLink({
  collapsed,
  module,
  organizationId,
}: {
  collapsed: boolean;
  module: ProductModule;
  organizationId: string;
}) {
  const Icon = moduleIcons[module.id] ?? FileText;
  const accessibleLabel =
    module.status === "coming_soon" ? `${module.label} 即将上线` : module.label;
  return (
    <NavLink
      aria-label={accessibleLabel}
      title={collapsed ? module.label : undefined}
      to={moduleHref(module, organizationId)}
    >
      <Icon aria-hidden className="navigation-icon" size={16} />
      {collapsed ? null : <span>{module.label}</span>}
      {module.status === "coming_soon" && !collapsed ? <small aria-hidden>即将上线</small> : null}
    </NavLink>
  );
}

export function Navigation({
  collapsed = false,
  organizationId,
  role,
}: {
  collapsed?: boolean;
  organizationId: string;
  role: MembershipRole;
}) {
  const visible = productModules.filter(
    (module) => module.context !== "organization" || module.roles.includes(role),
  );
  const groups = [
    { label: "全局", items: visible.filter((module) => module.context === "global") },
    { label: "个人空间", items: visible.filter((module) => module.context === "personal") },
    {
      label: "当前组织",
      items: visible.filter(
        (module) => module.context === "organization" && !module.route.includes("/admin/"),
      ),
    },
    {
      label: "组织管理",
      items: visible.filter(
        (module) => module.context === "organization" && module.route.includes("/admin/"),
      ),
    },
  ].filter((group) => group.items.length > 0);

  return (
    <nav aria-label="主导航" className="workspace-navigation">
      {groups.map((group) => (
        <section key={group.label} aria-label={group.label}>
          {collapsed ? null : <p>{group.label}</p>}
          {group.items.map((module) => (
            <ModuleLink
              collapsed={collapsed}
              key={module.id}
              module={module}
              organizationId={organizationId}
            />
          ))}
        </section>
      ))}
    </nav>
  );
}
