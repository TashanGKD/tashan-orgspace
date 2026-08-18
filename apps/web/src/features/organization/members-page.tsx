import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";

import type { OrgSpaceClient } from "@tashan/sdk";

function mutationKey(): string {
  return `web-member-add-${crypto.randomUUID()}`;
}

export function MembersPage({
  canManage,
  organizationId,
  sdk,
}: {
  canManage: boolean;
  organizationId: string;
  sdk: OrgSpaceClient;
}) {
  const queryClient = useQueryClient();
  const [accountId, setAccountId] = useState("");
  const [role, setRole] = useState<"org_admin" | "member">("member");
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
  });

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    addMember.mutate();
  }

  return (
    <section className="workspace-card">
      <p className="eyebrow">ORGANIZATION ADMIN</p>
      <h1>成员与角色</h1>
      {members.isPending ? <p>正在加载成员…</p> : null}
      {members.isError ? <p role="alert">成员列表加载失败。</p> : null}
      <ul className="device-list">
        {members.data?.items.map((membership) => (
          <li key={membership.id ?? membership.accountId}>
            <strong>{membership.username}</strong>
            <span>{membership.role}</span>
          </li>
        ))}
      </ul>
      {canManage ? (
        <form className="inline-form" onSubmit={submit}>
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
          <button disabled={addMember.isPending} type="submit">
            {addMember.isPending ? "正在添加…" : "添加成员"}
          </button>
        </form>
      ) : null}
      {addMember.isError ? <p role="alert">成员添加失败。</p> : null}
    </section>
  );
}
