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

const strategicCoreIds = new Set([
  "organization.home",
  "organization.tasks",
  "organization.files",
  "organization.messages",
]);

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
  return (
    <NavLink
      aria-label={module.label}
      title={collapsed ? module.label : undefined}
      to={moduleHref(module, organizationId)}
    >
      <Icon aria-hidden className="navigation-icon" size={16} />
      {collapsed ? null : <span>{module.label}</span>}
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
  const primary = visible.filter(
    (module) => module.status === "available" || strategicCoreIds.has(module.id),
  );
  const groups = [
    {
      label: "组织协作",
      items: primary.filter((module) => strategicCoreIds.has(module.id)),
    },
    {
      label: "设置与管理",
      items: primary.filter((module) => !strategicCoreIds.has(module.id)),
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
