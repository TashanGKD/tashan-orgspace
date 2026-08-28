import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { UserRoundPlus, Users } from "lucide-react";
import { useMemo, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router";

import type { MembershipSummary } from "@tashan/contracts";
import type { OrgSpaceClient } from "@tashan/sdk";

import { pageCopy } from "../../content/user-facing-copy.js";
import { Button, Sheet, SheetContent, SheetTitle } from "../../design-system/primitives/index.js";
import { ResourceDetailDrawer } from "../../platform/resources/resource-detail-drawer.js";
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
const membershipStatusLabels: Readonly<Record<MembershipSummary["status"], string>> = {
  active: "正常",
  suspended: "已停用",
  removed: "已移除",
};
const membershipStatusTones = {
  active: "success",
  suspended: "warning",
  removed: "neutral",
} as const;

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
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
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
      setAddOpen(false);
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
  const selectedMember = members.data?.items.find(
    (member) => member.accountId === selectedAccountId,
  );

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (submitLocked.current) return;
    submitLocked.current = true;
    addMember.mutate();
  }

  return (
    <>
      <ResourceListPage
        description={pageCopy.members.description}
        primaryAction={
          canManage ? (
            <Button disabled={addMember.isPending} onClick={() => setAddOpen(true)}>
              <UserRoundPlus aria-hidden size={16} />
              添加成员
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
        {members.isPending ? <ResourceState resourceLabel="成员" state="loading" /> : null}
        {members.isError ? <ResourceState resourceLabel="成员" state="fatal-error" /> : null}
        {!members.isPending && !members.isError && visibleMembers.length === 0 ? (
          <ResourceState resourceLabel="成员" state="empty" />
        ) : null}
        {visibleMembers.map((membership) => (
          <ResourceRow
            href={routes.organizationMember(organizationId, membership.accountId)}
            key={membership.id ?? membership.accountId}
            leading={<Users aria-hidden size={17} />}
            metadata={[roleLabels[membership.role]]}
            status={{
              label: membershipStatusLabels[membership.status],
              tone: membershipStatusTones[membership.status],
            }}
            title={membership.displayName}
          />
        ))}
      </ResourceListPage>

      <ResourceDetailDrawer
        detail={
          selectedMember ? (
            <dl className="resource-definition-list">
              <div>
                <dt>成员名称</dt>
                <dd>{selectedMember.displayName}</dd>
              </div>
              <div>
                <dt>组织角色</dt>
                <dd>{roleLabels[selectedMember.role]}</dd>
              </div>
              <div>
                <dt>状态</dt>
                <dd>{membershipStatusLabels[selectedMember.status]}</dd>
              </div>
              <div>
                <dt>加入时间</dt>
                <dd>{selectedMember.createdAt ?? "暂无记录"}</dd>
              </div>
              <div>
                <dt>最近更新</dt>
                <dd>{selectedMember.updatedAt ?? "暂无记录"}</dd>
              </div>
            </dl>
          ) : selectedAccountId && !members.isPending ? (
            <ResourceState resourceLabel="成员" state="fatal-error" />
          ) : (
            <ResourceState resourceLabel="成员" state="loading" />
          )
        }
        onOpenChange={(open) => {
          if (!open) navigate(routes.organizationMembers(organizationId));
        }}
        open={selectedAccountId !== undefined}
        technical={
          selectedMember ? (
            <dl className="resource-definition-list">
              <div>
                <dt>账号 ID</dt>
                <dd className="tabular-nums">{selectedMember.accountId}</dd>
              </div>
            </dl>
          ) : null
        }
        title={selectedMember?.displayName ?? "成员信息"}
        {...(selectedMember
          ? {
              subtitle: `${roleLabels[selectedMember.role]} · ${membershipStatusLabels[selectedMember.status]}`,
            }
          : {})}
      />

      <Sheet open={addOpen} onOpenChange={setAddOpen}>
        <SheetContent className="resource-form-sheet">
          <SheetTitle>添加成员</SheetTitle>
          <form aria-label="添加成员" className="resource-sheet-form" onSubmit={submit}>
            <div className="resource-sheet-form-body">
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
            </div>
            <footer className="resource-sheet-form-actions">
              <Button disabled={addMember.isPending} type="submit">
                {addMember.isPending ? "正在添加…" : "添加成员"}
              </Button>
            </footer>
          </form>
        </SheetContent>
      </Sheet>
    </>
  );
}
