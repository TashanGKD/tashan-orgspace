import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from "react";
import { useParams } from "react-router";

import type { MembershipSummary, OrganizationSummary } from "@tashan/contracts";
import type { OrgSpaceClient } from "@tashan/sdk";

export type MembershipRole = MembershipSummary["role"];
type OrganizationContextValue =
  | { status: "loading" }
  | { status: "forbidden" }
  | {
      status: "ready";
      organization: OrganizationSummary;
      organizations: readonly OrganizationSummary[];
      role: MembershipRole;
    };

const OrganizationContext = createContext<OrganizationContextValue | undefined>(undefined);

export function OrganizationProvider({
  accountId,
  children,
  sdk,
}: {
  accountId: string;
  children: ReactNode;
  sdk: OrgSpaceClient;
}) {
  const { organizationId } = useParams<{ organizationId: string }>();
  const queryClient = useQueryClient();
  const previousId = useRef<string | undefined>(undefined);

  useEffect(() => {
    const oldId = previousId.current;
    previousId.current = organizationId;
    if (oldId !== undefined && oldId !== organizationId) {
      void queryClient.cancelQueries({ queryKey: ["organization", oldId] });
    }
  }, [organizationId, queryClient]);

  const organizations = useQuery({
    queryKey: ["organizations"],
    queryFn: ({ signal }) => sdk.listOrganizations(signal),
  });
  const organization = organizations.data?.items.find((item) => item.id === organizationId);
  const members = useQuery({
    queryKey: ["organization", organizationId, "members"],
    queryFn: ({ signal }) => sdk.listMembers(organizationId ?? "", signal),
    enabled: organization !== undefined,
  });
  const membership = members.data?.items.find((item) => item.accountId === accountId);

  const value = useMemo<OrganizationContextValue>(() => {
    if (organizations.isPending || (organization !== undefined && members.isPending)) {
      return { status: "loading" };
    }
    if (organization === undefined || membership === undefined) return { status: "forbidden" };
    return {
      status: "ready",
      organization,
      organizations: organizations.data?.items ?? [],
      role: membership.role,
    };
  }, [membership, members.isPending, organization, organizations.isPending]);

  return <OrganizationContext.Provider value={value}>{children}</OrganizationContext.Provider>;
}

export function useOrganization(): OrganizationContextValue {
  const value = useContext(OrganizationContext);
  if (value === undefined) {
    throw new Error("useOrganization must be used inside OrganizationProvider");
  }
  return value;
}

export function RequireOrganizationRole({
  children,
  roles,
}: {
  children: ReactNode;
  roles: readonly MembershipRole[];
}) {
  const organization = useOrganization();
  if (organization.status === "loading") return <p>正在确认组织权限…</p>;
  if (organization.status === "forbidden" || !roles.includes(organization.role)) {
    return <p>你没有访问此页面的权限</p>;
  }
  return children;
}
