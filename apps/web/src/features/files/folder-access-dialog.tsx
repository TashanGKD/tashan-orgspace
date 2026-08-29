import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck, UserRoundPlus } from "lucide-react";
import { useState } from "react";

import type { OrgSpaceClient } from "@tashan/sdk";

import { Button, Sheet, SheetContent, SheetTitle } from "../../design-system/primitives/index.js";
import { ResourceState } from "../../platform/resources/resource-states.js";

const roleLabels = {
  manager: "可管理",
  editor: "可编辑",
  viewer: "只能查看",
} as const;

function key(prefix: string): string {
  return `web-folder-${prefix}-${crypto.randomUUID()}`;
}

export function FolderAccessDialog({
  canRecoverManager = false,
  effectiveRole,
  folderId,
  onOpenChange,
  open,
  sdk,
  spaceId,
}: {
  canRecoverManager?: boolean;
  effectiveRole: "manager" | "editor" | "viewer" | null;
  folderId: string;
  onOpenChange(open: boolean): void;
  open: boolean;
  sdk: OrgSpaceClient;
  spaceId: string;
}) {
  const queryClient = useQueryClient();
  const queryKey = ["files", spaceId, "folder-access", folderId] as const;
  const access = useQuery({
    queryKey,
    queryFn: ({ signal }) => sdk.readFolderAccess(spaceId, folderId, signal),
    enabled: open,
  });
  const [scope, setScope] = useState<"organization_public" | "restricted">("restricted");
  const [accountId, setAccountId] = useState("");
  const [role, setRole] = useState<"manager" | "editor" | "viewer">("viewer");
  const [recoveryAccountId, setRecoveryAccountId] = useState("");
  const [recoveryReason, setRecoveryReason] = useState("");
  const canManage = effectiveRole === "manager";
  const refresh = () => queryClient.invalidateQueries({ queryKey });
  const setAccess = useMutation({
    mutationFn: () =>
      sdk.setFolderAccess(
        spaceId,
        folderId,
        { scope, expectedVersion: access.data?.lockVersion },
        { idempotencyKey: key("access") },
      ),
    onSuccess: refresh,
  });
  const grant = useMutation({
    mutationFn: () =>
      sdk.setFolderGrant(
        spaceId,
        folderId,
        { accountId, role, expectedVersion: access.data?.lockVersion },
        { idempotencyKey: key("grant") },
      ),
    onSuccess: async () => {
      setAccountId("");
      await refresh();
    },
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="resource-form-sheet folder-access-sheet">
        <SheetTitle>文件夹权限</SheetTitle>
        <div className="resource-sheet-form-body">
          {access.isPending ? <ResourceState resourceLabel="文件夹权限" state="loading" /> : null}
          {access.isError ? <ResourceState resourceLabel="文件夹权限" state="fatal-error" /> : null}
          {access.data ? (
            <>
              <div className="folder-access-scope">
                <ShieldCheck aria-hidden size={18} />
                <div>
                  <strong>
                    {access.data.scope === "organization_public"
                      ? "组织成员可访问"
                      : "仅指定成员可访问"}
                  </strong>
                  <p>当前权限版本 {access.data.lockVersion}</p>
                </div>
              </div>
              <ul className="folder-grant-list">
                {access.data.grants.map((item) => (
                  <li key={item.accountId}>
                    <span className="tabular-nums">{item.accountId}</span>
                    <strong>{roleLabels[item.role]}</strong>
                    {canManage ? (
                      <Button
                        size="small"
                        variant="quiet"
                        onClick={() => {
                          if (!window.confirm(`移除 ${item.accountId} 的文件夹权限？`)) return;
                          void sdk
                            .revokeFolderGrant(spaceId, folderId, item.accountId, {
                              idempotencyKey: key("revoke"),
                            })
                            .then(refresh);
                        }}
                      >
                        移除
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
              {canManage ? (
                <>
                  <label>
                    访问范围
                    <select
                      value={scope}
                      onChange={(event) => setScope(event.target.value as typeof scope)}
                    >
                      <option value="organization_public">组织成员可访问</option>
                      <option value="restricted">仅指定成员可访问</option>
                    </select>
                  </label>
                  <Button
                    disabled={setAccess.isPending}
                    onClick={() => {
                      if (!window.confirm("保存新的文件夹访问范围？")) return;
                      setAccess.mutate();
                    }}
                  >
                    保存权限
                  </Button>
                  <div className="folder-grant-form">
                    <UserRoundPlus aria-hidden size={18} />
                    <input
                      aria-label="成员账号 ID"
                      placeholder="成员账号 ID"
                      value={accountId}
                      onChange={(event) => setAccountId(event.target.value)}
                    />
                    <select
                      aria-label="成员权限"
                      value={role}
                      onChange={(event) =>
                        setRole(event.target.value as "manager" | "editor" | "viewer")
                      }
                    >
                      <option value="viewer">只能查看</option>
                      <option value="editor">可编辑</option>
                      <option value="manager">可管理</option>
                    </select>
                    <Button
                      disabled={accountId.trim() === "" || grant.isPending}
                      onClick={() => grant.mutate()}
                    >
                      添加权限
                    </Button>
                  </div>
                </>
              ) : (
                <p className="resource-helper">你可以查看当前权限，但不能修改。</p>
              )}
              {canRecoverManager ? (
                <section className="folder-manager-recovery">
                  <h3>恢复文件夹管理员</h3>
                  <p className="resource-helper">仅在文件夹没有可用管理员时使用，并填写原因。</p>
                  <input
                    aria-label="恢复为管理员的账号 ID"
                    placeholder="成员账号 ID"
                    value={recoveryAccountId}
                    onChange={(event) => setRecoveryAccountId(event.target.value)}
                  />
                  <textarea
                    aria-label="恢复管理员的原因"
                    placeholder="说明恢复原因"
                    value={recoveryReason}
                    onChange={(event) => setRecoveryReason(event.target.value)}
                  />
                  <Button
                    disabled={recoveryAccountId.trim() === "" || recoveryReason.trim() === ""}
                    variant="secondary"
                    onClick={() => {
                      if (!window.confirm(`将 ${recoveryAccountId} 恢复为文件夹管理员？`)) return;
                      void sdk
                        .recoverFolderManager(
                          spaceId,
                          folderId,
                          {
                            accountId: recoveryAccountId,
                            reason: recoveryReason,
                            expectedVersion: access.data.lockVersion,
                          },
                          { idempotencyKey: key("manager-recover") },
                        )
                        .then(refresh);
                    }}
                  >
                    恢复管理员
                  </Button>
                </section>
              ) : null}
            </>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
