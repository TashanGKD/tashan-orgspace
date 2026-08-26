import { Ellipsis, FolderOpen, House, ListTodo, MessageCircle } from "lucide-react";
import { NavLink } from "react-router";

import { Button, Sheet, SheetContent, SheetTitle } from "../../design-system/primitives/index.js";
import type { MembershipRole } from "../context/organization-context.js";
import { productModules } from "../modules/module-catalog.js";
import { moduleHref } from "./navigation.js";

const primaryIds = new Map([
  ["organization.home", House],
  ["organization.tasks", ListTodo],
  ["organization.files", FolderOpen],
  ["organization.messages", MessageCircle],
]);

export function MobileNavigation({
  onOpenChange,
  open,
  organizationId,
  role,
}: {
  onOpenChange(open: boolean): void;
  open: boolean;
  organizationId: string;
  role: MembershipRole;
}) {
  const visible = productModules.filter(
    (module) => module.context !== "organization" || module.roles.includes(role),
  );
  const primary = visible.filter((module) => primaryIds.has(module.id));
  return (
    <>
      <nav aria-label="移动导航" className="mobile-navigation">
        {primary.map((module) => {
          const Icon = primaryIds.get(module.id) ?? House;
          return (
            <NavLink key={module.id} to={moduleHref(module, organizationId)}>
              <Icon aria-hidden size={19} />
              <span>{module.label.replace("组织", "")}</span>
            </NavLink>
          );
        })}
        <Button
          aria-label="更多导航"
          size="small"
          variant="quiet"
          onClick={() => onOpenChange(true)}
        >
          <Ellipsis aria-hidden size={19} />
          <span>更多</span>
        </Button>
      </nav>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="mobile-navigation-sheet">
          <SheetTitle>全部模块</SheetTitle>
          <nav aria-label="全部模块" className="mobile-all-modules">
            {visible.map((module) => (
              <NavLink
                key={module.id}
                to={moduleHref(module, organizationId)}
                onClick={() => onOpenChange(false)}
              >
                <span>{module.label}</span>
                {module.status === "coming_soon" ? <small>即将上线</small> : null}
              </NavLink>
            ))}
          </nav>
        </SheetContent>
      </Sheet>
    </>
  );
}
