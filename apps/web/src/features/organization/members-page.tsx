import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { UserRoundPlus, Users } from "lucide-react";
import { useMemo, useRef, useState, type FormEvent } from "react";

import type { MembershipSummary } from "@tashan/contracts";
import type { OrgSpaceClient } from "@tashan/sdk";

import { pageCopy } from "../../content/user-facing-copy.js";
import { Button } from "../../design-system/primitives/index.js";
import { ResourceDetailPage } from "../../platform/resources/resource-detail-page.js";
import { ResourceListPage } from "../../platform/resources/resource-list-page.js";
import {
  ResourceListToolbar,
  type ResourceView,
} from "../../platform/resources/resource-list-toolbar.js";
import { ResourceRow } from "../../platform/resources/resource-row.js";
import { ResourceState } from "../../platform/resources/resource-states.js";
import { routes } from "../../platform/routing/route-paths.js";

function mutationKey(): string {
  return `web-member-add-${crypto.randomUUID()}`;
}

const roleLabels = {
  org_owner: "组织所有者",
  org_admin: "组织管理员",
  member: "普通成员",
} as const;

function MemberDetail({ member }: { member: MembershipSummary }) {
  return (
    <ResourceDetailPage
      activity={
        <dl className="resource-definition-list">
          <div>
            <dt>加入时间</dt>
            <dd>{member.createdAt ?? "暂无记录"}</dd>
          </div>
          <div>
            <dt>最近更新</dt>
            <dd>{member.updatedAt ?? "暂无记录"}</dd>
          </div>
        </dl>
      }
      eyebrow="组织成员"
      subtitle={`${roleLabels[member.role]} · ${member.status === "active" ? "正常" : member.status}`}
      title={member.displayName}
    >
      <dl className="resource-definition-list">
        <div>
          <dt>成员名称</dt>
          <dd>{member.displayName}</dd>
        </div>
        <div>
          <dt>账号 ID</dt>
          <dd className="tabular-nums">{member.accountId}</dd>
        </div>
        <div>
          <dt>组织角色</dt>
          <dd>{roleLabels[member.role]}</dd>
        </div>
      </dl>
    </ResourceDetailPage>
  );
}

export function MembersPage({
  canManage,
  organizationId,
  sdk,
  selectedAccountId,
}: {
  canManage: boolean;
  organizationId: string;
  sdk: OrgSpaceClient;
  selectedAccountId?: string | undefined;
}) {
  const queryClient = useQueryClient();
  const [accountId, setAccountId] = useState("");
  const [role, setRole] = useState<"org_admin" | "member">("member");
  const [query, setQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState("all");
  const [view, setView] = useState<ResourceView>("list");
  const submitLocked = useRef(false);
  const members = useQuery({
    queryKey: ["organization", organizationId, "members"],
    queryFn: ({ signal }) => sdk.listMembers(organizationId, signal),
  });
  const addMember = useMutation({
    mutationFn: () =>
      sdk.addMember(organizationId, { accountId, role }, { idempotencyKey: mutationKey() }),
    onSuccess: async () => {
      setAccountId("");
      await queryClient.invalidateQueries({
        queryKey: ["organization", organizationId, "members"],
      });
    },
    onSettled: () => {
      submitLocked.current = false;
    },
  });
  const visibleMembers = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return (members.data?.items ?? []).filter(
      (member) =>
        (activeFilter === "all" || member.status === activeFilter) &&
        (normalizedQuery === "" ||
          member.displayName.toLocaleLowerCase().includes(normalizedQuery) ||
          member.accountId.toLocaleLowerCase().includes(normalizedQuery)),
    );
  }, [activeFilter, members.data?.items, query]);

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (submitLocked.current) return;
    submitLocked.current = true;
    addMember.mutate();
  }

  if (members.isPending) return <ResourceState resourceLabel="成员" state="loading" />;
  if (members.isError) return <ResourceState resourceLabel="成员" state="fatal-error" />;
  if (selectedAccountId !== undefined) {
    const selected = members.data.items.find((member) => member.accountId === selectedAccountId);
    return selected ? (
      <MemberDetail member={selected} />
    ) : (
      <ResourceState resourceLabel="成员" state="fatal-error" />
    );
  }

  return (
    <ResourceListPage
      description={pageCopy.members.description}
      primaryAction={
        canManage ? (
          <Button disabled={addMember.isPending} form="add-organization-member" type="submit">
            <UserRoundPlus aria-hidden size={16} />
            {addMember.isPending ? "正在添加…" : "添加成员"}
          </Button>
        ) : null
      }
      title="成员与角色"
      view={view}
      toolbar={
        <ResourceListToolbar
          activeFilter={activeFilter}
          filters={[
            { id: "all", label: "全部" },
            { id: "active", label: "正常" },
          ]}
          onFilterChange={setActiveFilter}
          onQueryChange={setQuery}
          onViewChange={setView}
          query={query}
          resourceLabel="成员"
          view={view}
        />
      }
    >
      {visibleMembers.length === 0 ? <ResourceState resourceLabel="成员" state="empty" /> : null}
      {visibleMembers.map((membership) => (
        <ResourceRow
          href={routes.organizationMember(organizationId, membership.accountId)}
          key={membership.id ?? membership.accountId}
          leading={<Users aria-hidden size={17} />}
          metadata={[roleLabels[membership.role]]}
          status={{
            label: membership.status === "active" ? "正常" : membership.status,
            tone: membership.status === "active" ? "success" : "warning",
          }}
          title={membership.displayName}
        />
      ))}
      {canManage ? (
        <form className="resource-inline-form" id="add-organization-member" onSubmit={submit}>
          <label>
            账号 ID
            <input
              required
              value={accountId}
              onChange={(event) => setAccountId(event.target.value)}
            />
          </label>
          <label>
            组织角色
            <select
              value={role}
              onChange={(event) => setRole(event.target.value as "org_admin" | "member")}
            >
              <option value="member">普通成员</option>
              <option value="org_admin">组织管理员</option>
            </select>
          </label>
          {addMember.isError ? <p role="alert">成员添加失败。</p> : null}
        </form>
      ) : null}
    </ResourceListPage>
  );
}
