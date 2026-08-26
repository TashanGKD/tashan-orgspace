import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Navigate, Route, Routes, useParams } from "react-router";

import type { DeviceLoginMetadata } from "@tashan/contracts";
import type { OrgSpaceClient } from "@tashan/sdk";

import { AccessPanel } from "./auth/access-panel.js";
import { AccountPage } from "./features/account/account-page.js";
import { AuditPage } from "./features/audit/audit-page.js";
import { OrganizationHomePage } from "./features/organization/home-page.js";
import { MembersPage } from "./features/organization/members-page.js";
import { ComingSoonPage } from "./features/roadmap/coming-soon-page.js";
import {
  OrganizationProvider,
  RequireOrganizationRole,
} from "./platform/context/organization-context.js";
import { createWebQueryClient } from "./platform/data/query-client.js";
import {
  FeedbackProvider,
  GlobalFeedback,
  useFeedback,
} from "./platform/feedback/feedback-context.js";
import { productModules } from "./platform/modules/module-catalog.js";
import { resourceSurface } from "./platform/resources/resource-surfaces.js";
import { routes } from "./platform/routing/route-paths.js";
import { AppShell } from "./platform/shell/app-shell.js";
import { SessionProvider, useSession } from "./platform/session/session-context.js";

const organizationSurface = resourceSurface("organization");
const deviceSurface = resourceSurface("device");
const memberSurface = resourceSurface("organization-member");
const auditSurface = resourceSurface("audit-event");

function organizationRelativeRoute(route: string): string {
  const prefix = "/org/:organizationId/";
  if (!route.startsWith(prefix)) throw new Error(`not an organization route: ${route}`);
  return route.slice(prefix.length);
}

function accountRelativeRoute(route: string): string {
  const prefix = `${deviceSurface.listRoute}/`;
  if (!route.startsWith(prefix)) throw new Error(`not an account detail route: ${route}`);
  return route.slice(prefix.length);
}

function LoginFlow() {
  const session = useSession();
  const feedback = useFeedback();
  const [busy, setBusy] = useState(false);

  async function perform(action: () => Promise<void>, notice?: string): Promise<void> {
    feedback.clear();
    setBusy(true);
    try {
      await action();
      if (notice !== undefined) feedback.showNotice(notice);
    } catch (error) {
      feedback.showError(error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AccessPanel
      busy={busy}
      onLogin={(phone, password) => perform(() => session.login(phone, password))}
      onSendVerificationCode={(phone, purpose) => session.sendVerificationCode(phone, purpose)}
      onRegister={(input) => perform(() => session.register(input))}
      onResetPassword={(input) =>
        perform(() => session.resetPassword(input), "密码已重置，请使用新密码登录。")
      }
    />
  );
}

function RootRedirect() {
  return <Navigate replace to={organizationSurface.listRoute} />;
}

function OrganizationArea({ sdk }: { sdk: OrgSpaceClient }) {
  const session = useSession();
  if (session.status !== "authenticated") return null;
  return (
    <OrganizationProvider accountId={session.account.id} sdk={sdk}>
      <OrganizationRoutes sdk={sdk} displayName={session.account.displayName} />
    </OrganizationProvider>
  );
}

function MembersRoute({ organizationId, sdk }: { organizationId: string; sdk: OrgSpaceClient }) {
  const { accountId } = useParams<{ accountId?: string }>();
  return (
    <MembersPage
      canManage
      organizationId={organizationId}
      sdk={sdk}
      selectedAccountId={accountId}
    />
  );
}

function AuditRoute({ organizationId, sdk }: { organizationId: string; sdk: OrgSpaceClient }) {
  const { eventId } = useParams<{ eventId?: string }>();
  return <AuditPage organizationId={organizationId} sdk={sdk} selectedEventId={eventId} />;
}

function AccountRoute({ sdk }: { sdk: OrgSpaceClient }) {
  const { deviceId } = useParams<{ deviceId?: string }>();
  return <AccountPage sdk={sdk} selectedDeviceId={deviceId} />;
}

function AccountShellRoutes({ sdk }: { sdk: OrgSpaceClient }) {
  const session = useSession();
  const feedback = useFeedback();
  if (session.status !== "authenticated") return null;

  async function logout(): Promise<void> {
    feedback.clear();
    try {
      await session.logout();
    } catch (error) {
      feedback.showError(error);
    }
  }

  return (
    <AppShell displayName={session.account.displayName} onLogout={logout}>
      <Routes>
        <Route index element={<AccountRoute sdk={sdk} />} />
        <Route
          path={accountRelativeRoute(deviceSurface.detailRoute)}
          element={<AccountRoute sdk={sdk} />}
        />
        <Route path="*" element={<Navigate replace to={deviceSurface.listRoute} />} />
      </Routes>
    </AppShell>
  );
}

function OrganizationListShell({
  organizationId,
  sdk,
}: {
  organizationId: string;
  sdk: OrgSpaceClient;
}) {
  const session = useSession();
  const feedback = useFeedback();
  if (session.status !== "authenticated") return null;

  async function logout(): Promise<void> {
    feedback.clear();
    try {
      await session.logout();
    } catch (error) {
      feedback.showError(error);
    }
  }

  return (
    <AppShell displayName={session.account.displayName} onLogout={logout}>
      <OrganizationHomePage organizationId={organizationId} sdk={sdk} />
    </AppShell>
  );
}

function OrganizationsArea({ sdk }: { sdk: OrgSpaceClient }) {
  const session = useSession();
  const organizations = useQuery({
    queryKey: ["organizations"],
    queryFn: ({ signal }) => sdk.listOrganizations(signal),
  });
  if (session.status !== "authenticated") return null;
  if (organizations.isPending) return <p>正在加载组织…</p>;
  const firstOrganization = organizations.data?.items[0];
  if (firstOrganization === undefined) {
    return <OrganizationHomePage organizationId="" sdk={sdk} />;
  }
  return (
    <OrganizationProvider
      accountId={session.account.id}
      organizationId={firstOrganization.id}
      sdk={sdk}
    >
      <OrganizationListShell organizationId={firstOrganization.id} sdk={sdk} />
    </OrganizationProvider>
  );
}

function AccountArea({ sdk }: { sdk: OrgSpaceClient }) {
  const session = useSession();
  const organizations = useQuery({
    queryKey: ["organizations"],
    queryFn: ({ signal }) => sdk.listOrganizations(signal),
  });
  if (session.status !== "authenticated") return null;
  if (organizations.isPending) return <p>正在加载组织…</p>;
  const firstOrganization = organizations.data?.items[0];
  if (firstOrganization === undefined) return <AccountRoute sdk={sdk} />;
  return (
    <OrganizationProvider
      accountId={session.account.id}
      organizationId={firstOrganization.id}
      sdk={sdk}
    >
      <AccountShellRoutes sdk={sdk} />
    </OrganizationProvider>
  );
}

function OrganizationRoutes({ sdk, displayName }: { sdk: OrgSpaceClient; displayName: string }) {
  const session = useSession();
  const feedback = useFeedback();
  const { organizationId = "" } = useParams<{ organizationId: string }>();
  const comingSoon = productModules.filter(
    (module) => module.context === "organization" && module.status === "coming_soon",
  );

  async function logout(): Promise<void> {
    feedback.clear();
    try {
      await session.logout();
    } catch (error) {
      feedback.showError(error);
    }
  }

  return (
    <AppShell displayName={displayName} onLogout={logout}>
      <Routes>
        <Route
          index
          element={
            <Navigate replace to={organizationRelativeRoute(organizationSurface.detailRoute)} />
          }
        />
        <Route
          path={organizationRelativeRoute(organizationSurface.detailRoute)}
          element={<OrganizationHomePage organizationId={organizationId} sdk={sdk} />}
        />
        <Route
          path={organizationRelativeRoute(memberSurface.listRoute)}
          element={
            <RequireOrganizationRole roles={["org_owner", "org_admin"]}>
              <MembersRoute organizationId={organizationId} sdk={sdk} />
            </RequireOrganizationRole>
          }
        />
        <Route
          path={organizationRelativeRoute(memberSurface.detailRoute)}
          element={
            <RequireOrganizationRole roles={["org_owner", "org_admin"]}>
              <MembersRoute organizationId={organizationId} sdk={sdk} />
            </RequireOrganizationRole>
          }
        />
        <Route
          path={organizationRelativeRoute(auditSurface.listRoute)}
          element={
            <RequireOrganizationRole roles={["org_owner", "org_admin"]}>
              <AuditRoute organizationId={organizationId} sdk={sdk} />
            </RequireOrganizationRole>
          }
        />
        <Route
          path={organizationRelativeRoute(auditSurface.detailRoute)}
          element={
            <RequireOrganizationRole roles={["org_owner", "org_admin"]}>
              <AuditRoute organizationId={organizationId} sdk={sdk} />
            </RequireOrganizationRole>
          }
        />
        {comingSoon.map((module) => {
          const suffix = module.route.split("/:organizationId/")[1];
          return (
            <Route
              key={module.id}
              path={suffix}
              element={
                <ComingSoonPage module={module} backTo={routes.organizationHome(organizationId)} />
              }
            />
          );
        })}
        <Route
          path="*"
          element={
            <Navigate replace to={organizationRelativeRoute(organizationSurface.detailRoute)} />
          }
        />
      </Routes>
    </AppShell>
  );
}

function AuthenticatedRoutes({ sdk }: { sdk: OrgSpaceClient }) {
  return (
    <Routes>
      <Route path="/" element={<RootRedirect />} />
      <Route path={organizationSurface.listRoute} element={<OrganizationsArea sdk={sdk} />} />
      <Route path={`${deviceSurface.listRoute}/*`} element={<AccountArea sdk={sdk} />} />
      <Route path="/org/:organizationId/*" element={<OrganizationArea sdk={sdk} />} />
      <Route path="*" element={<Navigate replace to="/" />} />
    </Routes>
  );
}

function AppContent({ sdk }: { sdk: OrgSpaceClient }) {
  const session = useSession();
  return (
    <div className="app-frame">
      <GlobalFeedback />
      {session.status === "restoring" ? <p>正在恢复安全会话…</p> : null}
      {session.status === "anonymous" ? <LoginFlow /> : null}
      {session.status === "authenticated" ? <AuthenticatedRoutes sdk={sdk} /> : null}
    </div>
  );
}

export function App({ sdk, device }: { sdk: OrgSpaceClient; device: DeviceLoginMetadata }) {
  const [queryClient] = useState(createWebQueryClient);
  return (
    <QueryClientProvider client={queryClient}>
      <FeedbackProvider>
        <SessionProvider device={device} sdk={sdk}>
          <AppContent sdk={sdk} />
        </SessionProvider>
      </FeedbackProvider>
    </QueryClientProvider>
  );
}
