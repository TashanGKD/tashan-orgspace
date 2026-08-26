import { Building2, Check, ChevronsUpDown, UserRound } from "lucide-react";
import { useNavigate } from "react-router";

import type { OrganizationSummary } from "@tashan/contracts";

import {
  Button,
  Menu,
  MenuContent,
  MenuItem,
  MenuTrigger,
} from "../../design-system/primitives/index.js";
import { routes } from "../routing/route-paths.js";

export function SpaceSwitcher({
  current,
  organizations,
}: {
  current: OrganizationSummary;
  organizations: readonly OrganizationSummary[];
}) {
  const navigate = useNavigate();
  return (
    <Menu>
      <MenuTrigger asChild>
        <Button
          aria-label={`当前空间：${current.name}`}
          className="space-switcher-trigger"
          variant="quiet"
        >
          <Building2 aria-hidden size={16} />
          <span>{current.name}</span>
          <ChevronsUpDown aria-hidden size={14} />
        </Button>
      </MenuTrigger>
      <MenuContent align="start" className="space-switcher-menu">
        <MenuItem disabled>
          <UserRound aria-hidden size={15} />
          我的空间
          <small>即将上线</small>
        </MenuItem>
        {organizations.map((organization) => (
          <MenuItem
            key={organization.id}
            onSelect={() => navigate(routes.organizationHome(organization.id))}
          >
            <Building2 aria-hidden size={15} />
            <span>{organization.name}</span>
            {organization.id === current.id ? <Check aria-hidden size={14} /> : null}
          </MenuItem>
        ))}
      </MenuContent>
    </Menu>
  );
}
