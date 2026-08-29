import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FolderOpen, History, KeyRound, Move, RotateCcw, Trash2 } from "lucide-react";
import { useState } from "react";

import type { OrgSpaceClient } from "@tashan/sdk";

import { Button } from "../../design-system/primitives/index.js";
import { ResourceDetailDrawer } from "../../platform/resources/resource-detail-drawer.js";
import { ResourceState } from "../../platform/resources/resource-states.js";
import { downloadVerified } from "./browser-file-transfer.js";
import { FolderAccessDialog } from "./folder-access-dialog.js";

const roleLabels = { manager: "可管理", editor: "可编辑", viewer: "只能查看" } as const;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

function key(prefix: string): string {
  return `web-file-${prefix}-${crypto.randomUUID()}`;
}

export function FileDetailDrawer({
  canRecoverManager = false,
  entryId,
  onClose,
  onOpenFolder,
  open,
  readonly,
  sdk,
  spaceId,
}: {
  canRecoverManager?: boolean;
  entryId?: string | undefined;
  onClose(): void;
  onOpenFolder(folderId: string, folderName: string): void;
  open: boolean;
  readonly: boolean;
  sdk: OrgSpaceClient;
  spaceId: string;
}) {
  const queryClient = useQueryClient();
  const [accessOpen, setAccessOpen] = useState(false);
  const entry = useQuery({
    queryKey: ["files", spaceId, "entry", entryId],
    queryFn: ({ signal }) => sdk.readFile(spaceId, entryId ?? "", signal),
    enabled: open && entryId !== undefined,
  });
  const versions = useQuery({
    queryKey: ["files", spaceId, "entry", entryId, "versions"],
    queryFn: ({ signal }) => sdk.listFileVersions(spaceId, entryId ?? "", signal),
    enabled: entry.data?.entry.kind === "file",
  });
  const refresh = () =>
    queryClient.invalidateQueries({
      predicate: (query) => query.queryKey.includes("files") && query.queryKey.includes(spaceId),
    });
  const download = useMutation({
    mutationFn: async () => {
      const signed = await sdk.createFileDownload(spaceId, entryId ?? "", {
        idempotencyKey: key("download"),
      });
      await downloadVerified({
        url: signed.url,
        expectedSha256: signed.checksumSha256,
        fileName: signed.fileName,
      });
    },
  });

  const selected = entry.data?.entry;
  async function trash(): Promise<void> {
    if (entryId === undefined || !window.confirm(`将“${selected?.name ?? "该项目"}”移入回收站？`))
      return;
    await sdk.trashFile(spaceId, entryId, { idempotencyKey: key("trash") });
    await refresh();
    onClose();
  }
  async function restore(): Promise<void> {
    if (entryId === undefined || selected === undefined) return;
    await sdk.restoreFile(
      spaceId,
      entryId,
      { expectedVersion: selected.lockVersion },
      { idempotencyKey: key("restore") },
    );
    await refresh();
  }
  async function remove(): Promise<void> {
    if (
      entryId === undefined ||
      !window.confirm(`永久删除“${selected?.name ?? "该项目"}”及其全部版本？此操作无法撤销。`)
    )
      return;
    await sdk.deleteFile(spaceId, entryId, { idempotencyKey: key("delete") });
    await refresh();
    onClose();
  }

  return (
    <>
      <ResourceDetailDrawer
        detail={
          entry.isPending ? (
            <ResourceState resourceLabel="文件" state="loading" />
          ) : entry.isError || selected === undefined ? (
            <ResourceState resourceLabel="文件" state="fatal-error" />
          ) : (
            <>
              <dl className="resource-definition-list">
                <div>
                  <dt>类型</dt>
                  <dd>{selected.kind === "folder" ? "文件夹" : "文件"}</dd>
                </div>
                <div>
                  <dt>大小</dt>
                  <dd>{formatBytes(selected.sizeBytes)}</dd>
                </div>
                <div>
                  <dt>权限</dt>
                  <dd>
                    {selected.effectiveRole ? roleLabels[selected.effectiveRole] : "不可访问"}
                  </dd>
                </div>
                <div>
                  <dt>更新时间</dt>
                  <dd>{new Date(selected.updatedAt).toLocaleString("zh-CN")}</dd>
                </div>
              </dl>
              <div className="file-detail-actions">
                {selected.kind === "folder" ? (
                  <>
                    <Button onClick={() => onOpenFolder(selected.id, selected.name)}>
                      <FolderOpen aria-hidden size={16} />
                      打开文件夹
                    </Button>
                    <Button variant="secondary" onClick={() => setAccessOpen(true)}>
                      <KeyRound aria-hidden size={16} />
                      查看权限
                    </Button>
                  </>
                ) : (
                  <Button disabled={download.isPending} onClick={() => download.mutate()}>
                    <Download aria-hidden size={16} />
                    下载文件
                  </Button>
                )}
                {!readonly && selected.state === "active" ? (
                  <>
                    <Button
                      variant="quiet"
                      onClick={() => {
                        const targetParentId = window.prompt("输入目标文件夹 ID");
                        if (targetParentId === null || targetParentId.trim() === "") return;
                        void sdk
                          .moveFile(
                            spaceId,
                            selected.id,
                            {
                              targetParentId: targetParentId.trim(),
                              expectedVersion: selected.lockVersion,
                            },
                            { idempotencyKey: key("move") },
                          )
                          .then(refresh);
                      }}
                    >
                      <Move aria-hidden size={16} />
                      移动
                    </Button>
                    <Button variant="secondary" onClick={() => void trash()}>
                      <Trash2 aria-hidden size={16} />
                      移入回收站
                    </Button>
                  </>
                ) : null}
                {!readonly && selected.state === "trash" ? (
                  <>
                    <Button onClick={() => void restore()}>
                      <RotateCcw aria-hidden size={16} />
                      恢复文件
                    </Button>
                    <Button variant="danger" onClick={() => void remove()}>
                      <Trash2 aria-hidden size={16} />
                      永久删除
                    </Button>
                  </>
                ) : null}
              </div>
              {download.isError ? <p role="alert">下载失败，请重试。</p> : null}
              {selected.kind === "file" ? (
                <section className="file-version-section">
                  <h2>
                    <History aria-hidden size={17} />
                    文件版本
                  </h2>
                  {versions.data?.items.length === 0 ? <p>还没有历史版本</p> : null}
                  {versions.data?.items.map((version) => (
                    <article className="file-version-row" key={version.id}>
                      <span>版本 {version.versionNumber}</span>
                      <small>{formatBytes(version.sizeBytes)}</small>
                      {!readonly && version.id !== selected.currentVersionId ? (
                        <Button
                          size="small"
                          variant="quiet"
                          onClick={() => {
                            if (!window.confirm(`恢复到版本 ${version.versionNumber}？`)) return;
                            void sdk
                              .restoreFileVersion(
                                spaceId,
                                selected.id,
                                version.id,
                                { expectedVersion: selected.lockVersion },
                                { idempotencyKey: key("version-restore") },
                              )
                              .then(refresh);
                          }}
                        >
                          恢复此版本
                        </Button>
                      ) : null}
                    </article>
                  ))}
                </section>
              ) : null}
            </>
          )
        }
        onOpenChange={(next) => {
          if (!next) onClose();
        }}
        open={open}
        title={selected?.name ?? "文件信息"}
        {...(selected
          ? { subtitle: selected.kind === "folder" ? "文件夹" : (selected.contentType ?? "文件") }
          : {})}
      />
      {selected?.kind === "folder" ? (
        <FolderAccessDialog
          canRecoverManager={canRecoverManager}
          effectiveRole={selected.effectiveRole}
          folderId={selected.id}
          open={accessOpen}
          sdk={sdk}
          spaceId={spaceId}
          onOpenChange={setAccessOpen}
        />
      ) : null}
    </>
  );
}
