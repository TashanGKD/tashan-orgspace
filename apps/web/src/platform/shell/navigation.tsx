import { NavLink } from "react-router";

import { OrganizationId } from "@tashan/contracts";

import { productModules, type ProductModule } from "../modules/module-catalog.js";

type MembershipRole = "org_owner" | "org_admin" | "member";

function moduleHref(module: ProductModule, organizationId: string): string {
  if (module.context !== "organization") return module.route;
  return module.route.replace(
    ":organizationId",
    encodeURIComponent(OrganizationId.parse(organizationId)),
  );
}

function ModuleLink({ module, organizationId }: { module: ProductModule; organizationId: string }) {
  return (
    <NavLink to={moduleHref(module, organizationId)}>
      <span>{module.label}</span>
      {module.status === "coming_soon" ? <small aria-label="即将上线">即将上线</small> : null}
    </NavLink>
  );
}

export function Navigation({
  organizationId,
  role,
}: {
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
          <p>{group.label}</p>
          {group.items.map((module) => (
            <ModuleLink key={module.id} module={module} organizationId={organizationId} />
          ))}
        </section>
      ))}
    </nav>
  );
}
