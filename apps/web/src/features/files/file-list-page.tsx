import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { File, Folder, FolderPlus, HardDrive, Upload } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { useNavigate } from "react-router";

import { OrgSpaceApiError, type OrgSpaceClient } from "@tashan/sdk";

import { Button, Sheet, SheetContent, SheetTitle } from "../../design-system/primitives/index.js";
import { ResourceListPage } from "../../platform/resources/resource-list-page.js";
import {
  ResourceListToolbar,
  type ResourceView,
} from "../../platform/resources/resource-list-toolbar.js";
import { ResourceRow } from "../../platform/resources/resource-row.js";
import { ResourceState } from "../../platform/resources/resource-states.js";
import { FileDetailDrawer } from "./file-detail-drawer.js";
import { FileUploadDialog } from "./file-upload-dialog.js";

type FileScope = { type: "personal" } | { type: "organization"; organizationId: string };

function formatBytes(bytes: number): string {
  if (bytes < 1024 ** 3) return `${Math.round(bytes / 1024 ** 2)} MB`;
  const value = bytes / 1024 ** 3;
  return `${Number.isInteger(value) ? value : value.toFixed(1)} GB`;
}

function idempotencyKey(prefix: string): string {
  return `web-file-${prefix}-${crypto.randomUUID()}`;
}

function FolderCreateDialog({
  onOpenChange,
  open,
  parentId,
  sdk,
  spaceId,
}: {
  onOpenChange(open: boolean): void;
  open: boolean;
  parentId: string;
  sdk: OrgSpaceClient;
  spaceId: string;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [scope, setScope] = useState<"organization_public" | "restricted">("restricted");
  const create = useMutation({
    mutationFn: () =>
      sdk.createFolder(
        spaceId,
        { parentId, name, accessScope: scope, grants: [] },
        { idempotencyKey: idempotencyKey("mkdir") },
      ),
    onSuccess: async () => {
      setName("");
      onOpenChange(false);
      await queryClient.invalidateQueries({
        predicate: (query) => query.queryKey.includes("files") && query.queryKey.includes(spaceId),
      });
    },
  });
  function submit(event: FormEvent): void {
    event.preventDefault();
    create.mutate();
  }
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="resource-form-sheet">
        <SheetTitle>新建文件夹</SheetTitle>
        <form aria-label="新建文件夹" className="resource-sheet-form" onSubmit={submit}>
          <div className="resource-sheet-form-body">
            <label>
              文件夹名称
              <input required value={name} onChange={(event) => setName(event.target.value)} />
            </label>
            <label>
              谁可以访问
              <select
                value={scope}
                onChange={(event) => setScope(event.target.value as typeof scope)}
              >
                <option value="restricted">仅指定成员</option>
                <option value="organization_public">组织内成员</option>
              </select>
            </label>
            {create.isError ? <p role="alert">文件夹创建失败。</p> : null}
          </div>
          <footer className="resource-sheet-form-actions">
            <Button disabled={create.isPending} type="submit">
              创建文件夹
            </Button>
          </footer>
        </form>
      </SheetContent>
    </Sheet>
  );
}

function PersonalQuotaDialog({
  onOpenChange,
  open,
  organizationId,
  sdk,
}: {
  onOpenChange(open: boolean): void;
  open: boolean;
  organizationId: string;
  sdk: OrgSpaceClient;
}) {
  const [accountId, setAccountId] = useState("");
  const [quotaGb, setQuotaGb] = useState("50");
  const quota = useMutation({
    mutationFn: () =>
      sdk.setPersonalSpaceQuota(
        organizationId,
        accountId,
        { quotaBytes: Number(quotaGb) * 1024 ** 3 },
        { idempotencyKey: idempotencyKey("quota") },
      ),
    onSuccess: () => onOpenChange(false),
  });
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="resource-form-sheet">
        <SheetTitle>调整个人空间额度</SheetTitle>
        <form
          aria-label="调整个人空间额度"
          className="resource-sheet-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!window.confirm(`将该成员的个人空间额度调整为 ${quotaGb} GB？`)) return;
            quota.mutate();
          }}
        >
          <div className="resource-sheet-form-body">
            <label>
              成员账号 ID
              <input
                required
                value={accountId}
                onChange={(event) => setAccountId(event.target.value)}
              />
            </label>
            <label>
              额度（GB）
              <input
                required
                max="500"
                min="50"
                step="1"
                type="number"
                value={quotaGb}
                onChange={(event) => setQuotaGb(event.target.value)}
              />
            </label>
            {quota.isError ? <p role="alert">额度调整失败。</p> : null}
          </div>
          <footer className="resource-sheet-form-actions">
            <Button disabled={quota.isPending} type="submit">
              保存额度
            </Button>
          </footer>
        </form>
      </SheetContent>
    </Sheet>
  );
}

export function FilesPage({
  canRecoverManager = false,
  scope,
  sdk,
  selectedEntryId,
}: {
  canRecoverManager?: boolean;
  scope: FileScope;
  sdk: OrgSpaceClient;
  selectedEntryId?: string | undefined;
}) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [view, setView] = useState<ResourceView>("list");
  const [includeTrash, setIncludeTrash] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [folderOpen, setFolderOpen] = useState(false);
  const [quotaOpen, setQuotaOpen] = useState(false);
  const [breadcrumbs, setBreadcrumbs] = useState<Array<{ id: string; name: string }>>([]);
  const spaces = useQuery({
    queryKey: ["spaces", scope.type, scope.type === "organization" ? scope.organizationId : "self"],
    queryFn: ({ signal }) => sdk.listSpaces(signal),
  });
  const selectedSpace = spaces.data?.items.find((item) =>
    scope.type === "personal"
      ? item.type === "personal"
      : item.type === "organization" && item.organizationId === scope.organizationId,
  );
  const parentId = breadcrumbs.at(-1)?.id ?? selectedSpace?.rootFolderId;
  const listKey =
    scope.type === "organization"
      ? ["organization", scope.organizationId, "files", selectedSpace?.id, parentId, includeTrash]
      : ["files", selectedSpace?.id, parentId, includeTrash];
  const files = useQuery({
    queryKey: listKey,
    queryFn: ({ signal }) =>
      sdk.listFiles(selectedSpace?.id ?? "", { parentId, includeTrash }, signal),
    enabled: selectedSpace !== undefined && parentId !== undefined && query.trim() === "",
  });
  const search = useQuery({
    queryKey:
      scope.type === "organization"
        ? ["organization", scope.organizationId, "files", selectedSpace?.id, "search", query]
        : ["files", selectedSpace?.id, "search", query],
    queryFn: ({ signal }) =>
      sdk.searchFiles(selectedSpace?.id ?? "", { query: query.trim() }, signal),
    enabled: selectedSpace !== undefined && query.trim() !== "",
  });
  const visible = useMemo(
    () => (query.trim() === "" ? (files.data?.items ?? []) : (search.data?.items ?? [])),
    [files.data?.items, query, search.data?.items],
  );
  const readonly = selectedSpace?.writeState === "quota_readonly";
  const title = scope.type === "personal" ? "个人文件" : "组织文件";
  const basePath =
    scope.type === "personal" ? "/personal/files" : `/org/${scope.organizationId}/files`;
  const pending = spaces.isPending || (query.trim() === "" ? files.isPending : search.isPending);
  const failed = spaces.isError || (query.trim() === "" ? files.isError : search.isError);
  const loadError = spaces.error ?? (query.trim() === "" ? files.error : search.error);
  const errorState =
    loadError instanceof OrgSpaceApiError && loadError.status === 403
      ? "forbidden"
      : loadError instanceof OrgSpaceApiError && loadError.status === 409
        ? "version-conflict"
        : "fatal-error";

  return (
    <>
      <ResourceListPage
        description={scope.type === "personal" ? "查看和管理个人文件" : "查看和管理组织文件"}
        primaryAction={
          <div className="file-primary-actions">
            {scope.type === "organization" && canRecoverManager ? (
              <Button variant="secondary" onClick={() => setQuotaOpen(true)}>
                调整成员额度
              </Button>
            ) : null}
            <Button
              disabled={readonly || selectedSpace === undefined}
              variant="secondary"
              onClick={() => setFolderOpen(true)}
            >
              <FolderPlus aria-hidden size={16} />
              新建文件夹
            </Button>
            <Button
              disabled={readonly || selectedSpace === undefined}
              onClick={() => setUploadOpen(true)}
            >
              <Upload aria-hidden size={16} />
              上传文件
            </Button>
          </div>
        }
        summary={
          selectedSpace ? (
            <>
              <article className="file-usage-card">
                <HardDrive aria-hidden size={18} />
                <span>已使用 {formatBytes(selectedSpace.usedBytes)}</span>
              </article>
              <article className="file-usage-card">
                <Upload aria-hidden size={18} />
                <span>上传中 {formatBytes(selectedSpace.reservedBytes)}</span>
              </article>
              <article className="file-usage-card">
                <span className="file-usage-value">{formatBytes(selectedSpace.quotaBytes)}</span>
                <span>空间额度</span>
              </article>
            </>
          ) : null
        }
        title={title}
        view={view}
        toolbar={
          <ResourceListToolbar
            activeFilter={includeTrash ? "trash" : "active"}
            filters={[
              { id: "active", label: "文件" },
              { id: "trash", label: "回收站" },
            ]}
            onFilterChange={(filter) => setIncludeTrash(filter === "trash")}
            onQueryChange={setQuery}
            onViewChange={setView}
            query={query}
            resourceLabel="文件"
            view={view}
          />
        }
      >
        <nav aria-label="当前位置" className="file-breadcrumbs">
          <button type="button" onClick={() => setBreadcrumbs([])}>
            {title}
          </button>
          {breadcrumbs.map((item, index) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setBreadcrumbs((current) => current.slice(0, index + 1))}
            >
              {item.name}
            </button>
          ))}
        </nav>
        {readonly ? <ResourceState resourceLabel="文件" state="readonly" /> : null}
        {pending ? <ResourceState resourceLabel="文件" state="loading" /> : null}
        {failed ? <ResourceState resourceLabel="文件" state={errorState} /> : null}
        {!pending && !failed && visible.length === 0 ? (
          <ResourceState resourceLabel="文件" state="empty" />
        ) : null}
        {visible.map((entry) => (
          <ResourceRow
            href={`${basePath}/${entry.id}`}
            key={entry.id}
            leading={
              entry.kind === "folder" ? (
                <Folder aria-hidden size={17} />
              ) : (
                <File aria-hidden size={17} />
              )
            }
            metadata={[
              entry.kind === "folder" ? "文件夹" : formatBytes(entry.sizeBytes),
              new Date(entry.updatedAt).toLocaleDateString("zh-CN"),
            ]}
            status={{
              label:
                entry.state === "trash"
                  ? "回收站"
                  : entry.currentVersionId === null && entry.kind === "file"
                    ? "处理中"
                    : "可用",
              tone: entry.state === "trash" ? "warning" : "success",
            }}
            title={entry.name}
          />
        ))}
      </ResourceListPage>
      {selectedSpace && parentId ? (
        <>
          <FileUploadDialog
            open={uploadOpen}
            parentId={parentId}
            sdk={sdk}
            spaceId={selectedSpace.id}
            onOpenChange={setUploadOpen}
          />
          <FolderCreateDialog
            open={folderOpen}
            parentId={parentId}
            sdk={sdk}
            spaceId={selectedSpace.id}
            onOpenChange={setFolderOpen}
          />
          {scope.type === "organization" ? (
            <PersonalQuotaDialog
              open={quotaOpen}
              organizationId={scope.organizationId}
              sdk={sdk}
              onOpenChange={setQuotaOpen}
            />
          ) : null}
          <FileDetailDrawer
            canRecoverManager={canRecoverManager}
            entryId={selectedEntryId}
            open={selectedEntryId !== undefined}
            readonly={readonly}
            sdk={sdk}
            spaceId={selectedSpace.id}
            onClose={() => navigate(basePath)}
            onOpenFolder={(id, name) => {
              setBreadcrumbs((current) => [...current, { id, name }]);
              navigate(basePath);
            }}
          />
        </>
      ) : null}
    </>
  );
}

export function SpaceUsagePage({ scope, sdk }: { scope: FileScope; sdk: OrgSpaceClient }) {
  const spaces = useQuery({
    queryKey: ["spaces", scope.type, "usage"],
    queryFn: ({ signal }) => sdk.listSpaces(signal),
  });
  const selected = spaces.data?.items.find((item) =>
    scope.type === "personal"
      ? item.type === "personal"
      : item.organizationId === scope.organizationId,
  );
  const usage = useQuery({
    queryKey: ["files", selected?.id, "usage"],
    queryFn: ({ signal }) => sdk.readSpaceUsage(selected?.id ?? "", signal),
    enabled: selected !== undefined,
  });
  return (
    <ResourceListPage description="查看个人存储用量" title="个人用量">
      {spaces.isPending || usage.isPending ? (
        <ResourceState resourceLabel="用量" state="loading" />
      ) : null}
      {spaces.isError || usage.isError ? (
        <ResourceState resourceLabel="用量" state="fatal-error" />
      ) : null}
      {usage.data ? (
        <section className="space-usage-detail">
          <strong>{formatBytes(usage.data.usedBytes)}</strong>
          <span>已使用，共 {formatBytes(usage.data.quotaBytes)}</span>
          <progress
            aria-label="存储使用比例"
            max={usage.data.quotaBytes}
            value={usage.data.usedBytes + usage.data.reservedBytes}
          />
          <small>另有 {formatBytes(usage.data.reservedBytes)} 正在上传</small>
        </section>
      ) : null}
    </ResourceListPage>
  );
}
