import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, test, vi } from "vitest";

import { OrgSpaceApiError, type OrgSpaceClient } from "@tashan/sdk";

import { createWebQueryClient } from "../../platform/data/query-client.js";
import { FileUploadDialog } from "./file-upload-dialog.js";
import { FilesPage } from "./file-list-page.js";
import { FolderAccessDialog } from "./folder-access-dialog.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const organizationId = "95d5579d-a32d-4650-aec4-318ff3a55df1";
const spaceId = "35f503c2-a5d7-4250-a337-4f4fd03cf8df";
const rootFolderId = "84ecfe2e-c11a-4a56-8735-934955bef834";
const fileId = "b228e557-2214-4f95-b49d-d4ff7d9759d4";
const folderId = "3c5442ea-00e2-483b-9e81-2271e34120f1";
const uploadId = "746fb70b-a27e-4a78-a231-aa55ef8c343e";
const now = "2026-08-29T00:00:00.000Z";

function space(type: "personal" | "organization", writeState = "writable") {
  return {
    id: spaceId,
    type,
    accountId: type === "personal" ? fileId : null,
    organizationId: type === "organization" ? organizationId : null,
    rootFolderId,
    quotaBytes: 50 * 1024 ** 3,
    usedBytes: 12 * 1024 ** 3,
    reservedBytes: 2 * 1024 ** 3,
    writeState,
    createdAt: now,
    updatedAt: now,
  };
}

const entries = [
  {
    id: folderId,
    spaceId,
    parentId: rootFolderId,
    kind: "folder",
    name: "合作资料",
    state: "active",
    lockVersion: 1,
    createdByAccountId: fileId,
    currentVersionId: null,
    sizeBytes: 0,
    contentType: null,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: fileId,
    spaceId,
    parentId: rootFolderId,
    kind: "file",
    name: "会议纪要.pdf",
    state: "active",
    lockVersion: 3,
    createdByAccountId: fileId,
    currentVersionId: uploadId,
    sizeBytes: 2048,
    contentType: "application/pdf",
    createdAt: now,
    updatedAt: now,
  },
] as const;

function renderPage(
  sdk: OrgSpaceClient,
  scope: { type: "personal" } | { type: "organization"; organizationId: string },
  selectedEntryId?: string,
) {
  return render(
    <QueryClientProvider client={createWebQueryClient()}>
      <MemoryRouter>
        <FilesPage scope={scope} sdk={sdk} selectedEntryId={selectedEntryId} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("FilesPage", () => {
  test("renders personal files as a list with quota, breadcrumbs and deep-linked detail", async () => {
    const sdk = {
      listSpaces: vi.fn().mockResolvedValue({ items: [space("personal")] }),
      listFiles: vi.fn().mockResolvedValue({ items: entries, nextCursor: null }),
      readFile: vi.fn().mockResolvedValue({
        entry: {
          ...entries[1],
          inheritedFromFolderId: rootFolderId,
          effectiveRole: "manager",
          checksumSha256: "a".repeat(64),
        },
      }),
      listFileVersions: vi.fn().mockResolvedValue({ items: [] }),
    } as unknown as OrgSpaceClient;
    renderPage(sdk, { type: "personal" }, fileId);
    expect(await screen.findByRole("heading", { name: "个人文件" })).toBeVisible();
    expect(screen.getByLabelText("当前位置")).toHaveTextContent("个人文件");
    expect(await screen.findByText("已使用 12 GB")).toBeVisible();
    expect(screen.getByText("上传中 2 GB")).toBeVisible();
    const fileName = await screen.findByText("会议纪要.pdf", { selector: "strong" });
    expect(fileName.closest("a")).toHaveAttribute("href", `/personal/files/${fileId}`);
    const detail = await screen.findByRole("dialog", { name: "会议纪要.pdf" });
    expect(detail).toHaveTextContent("2 KB");
    expect(detail).toHaveTextContent("可管理");
    expect(sdk.listFiles).toHaveBeenCalledWith(
      spaceId,
      expect.objectContaining({ parentId: rootFolderId }),
      expect.anything(),
    );
  });

  test("uses organization-scoped queries, metadata search and readonly controls", async () => {
    const sdk = {
      listSpaces: vi.fn().mockResolvedValue({ items: [space("organization", "quota_readonly")] }),
      listFiles: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
      searchFiles: vi.fn().mockResolvedValue({ items: entries, nextCursor: null }),
    } as unknown as OrgSpaceClient;
    renderPage(sdk, { type: "organization", organizationId });
    expect(await screen.findByRole("heading", { name: "组织文件" })).toBeVisible();
    expect(await screen.findByText("文件当前为只读")).toBeVisible();
    expect(screen.getByRole("button", { name: "上传文件" })).toBeDisabled();
    const user = userEvent.setup();
    await user.type(screen.getByRole("searchbox", { name: "搜索文件" }), "会议");
    await waitFor(() =>
      expect(sdk.searchFiles).toHaveBeenCalledWith(spaceId, { query: "会议" }, expect.anything()),
    );
    expect(await screen.findByText("会议纪要.pdf")).toBeVisible();
  });

  test.each([
    ["loading", "正在加载文件"],
    ["error", "文件加载失败"],
    ["forbidden", "无权查看文件"],
    ["conflict", "文件已被其他人更新"],
    ["empty", "还没有文件"],
  ])("shows an explicit %s list state", async (mode, expected) => {
    const sdk = {
      listSpaces: vi.fn().mockResolvedValue({ items: [space("personal")] }),
      listFiles: vi.fn().mockImplementation(() => {
        if (mode === "loading") return new Promise(() => undefined);
        if (mode === "error")
          return Promise.reject(
            new OrgSpaceApiError("VALIDATION_FAILED", 400, "请求失败", crypto.randomUUID()),
          );
        if (mode === "forbidden")
          return Promise.reject(
            new OrgSpaceApiError("FILE_FORBIDDEN", 403, "无权访问", crypto.randomUUID()),
          );
        if (mode === "conflict")
          return Promise.reject(
            new OrgSpaceApiError("FILE_VERSION_CONFLICT", 409, "内容已更新", crypto.randomUUID()),
          );
        return Promise.resolve({ items: [], nextCursor: null });
      }),
    } as unknown as OrgSpaceClient;
    renderPage(sdk, { type: "personal" });
    expect(await screen.findByText(expected)).toBeVisible();
  });
});

describe("file dialogs", () => {
  test("resumes from server-confirmed parts and polls verification without storing signed URLs", async () => {
    const checksumPartOne = "+44g/C5MPySMYMOb1lLzwTRymLuXe4tNWQO4UFViBgM=";
    const session = {
      id: uploadId,
      spaceId,
      parentId: rootFolderId,
      fileName: "data.bin",
      contentType: "application/octet-stream",
      expectedSizeBytes: 3,
      partSizeBytes: 2,
      partCount: 2,
      status: "uploading",
      expiresAt: "2026-08-30T00:00:00.000Z",
      createdAt: now,
    };
    const sdk = {
      listUploads: vi.fn().mockResolvedValue({ items: [] }),
      createUpload: vi.fn().mockResolvedValue({ uploadSession: session }),
      readUpload: vi
        .fn()
        .mockResolvedValueOnce({
          uploadSession: session,
          uploadedParts: [
            { partNumber: 1, etag: '"etag-1"', checksumSha256: checksumPartOne, sizeBytes: 2 },
          ],
        })
        .mockResolvedValue({
          uploadSession: { ...session, status: "completed", completedVersionId: fileId },
          uploadedParts: [],
        }),
      createUploadPartUrls: vi.fn().mockResolvedValue({
        items: [{ partNumber: 2, url: "https://files.example/part-2", expiresAt: now }],
      }),
      completeUpload: vi.fn().mockResolvedValue({
        uploadSession: { ...session, status: "verifying" },
      }),
    } as unknown as OrgSpaceClient;
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 200, headers: { etag: '"etag-2"' } }));
    const storageSpy = vi.spyOn(Storage.prototype, "setItem");
    render(
      <QueryClientProvider client={createWebQueryClient()}>
        <FileUploadDialog
          open
          parentId={rootFolderId}
          sdk={sdk}
          spaceId={spaceId}
          onOpenChange={vi.fn()}
        />
      </QueryClientProvider>,
    );
    const user = userEvent.setup();
    await user.upload(screen.getByLabelText("选择文件"), new File(["abc"], "data.bin"));
    await user.click(screen.getByRole("button", { name: "开始上传" }));
    await waitFor(() => expect(sdk.createUpload).toHaveBeenCalledOnce());
    expect(await screen.findByText("上传完成")).toBeVisible();
    expect(sdk.createUploadPartUrls).toHaveBeenCalledWith(
      spaceId,
      uploadId,
      { partNumbers: [2] },
      expect.anything(),
    );
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(storageSpy).not.toHaveBeenCalled();
  });

  test("shows folder roles to everyone but management controls only to managers", async () => {
    const sdk = {
      readFolderAccess: vi.fn().mockResolvedValue({
        folderId,
        scope: "restricted",
        lockVersion: 2,
        inheritedFromFolderId: folderId,
        grants: [{ accountId: fileId, role: "viewer" }],
      }),
      setFolderAccess: vi.fn(),
    } as unknown as OrgSpaceClient;
    const { rerender } = render(
      <QueryClientProvider client={createWebQueryClient()}>
        <FolderAccessDialog
          effectiveRole="viewer"
          folderId={folderId}
          open
          sdk={sdk}
          spaceId={spaceId}
          onOpenChange={vi.fn()}
        />
      </QueryClientProvider>,
    );
    expect(await screen.findByText("只能查看")).toBeVisible();
    expect(screen.queryByRole("button", { name: "保存权限" })).not.toBeInTheDocument();
    rerender(
      <QueryClientProvider client={createWebQueryClient()}>
        <FolderAccessDialog
          effectiveRole="manager"
          folderId={folderId}
          open
          sdk={sdk}
          spaceId={spaceId}
          onOpenChange={vi.fn()}
        />
      </QueryClientProvider>,
    );
    expect(await screen.findByRole("button", { name: "保存权限" })).toBeVisible();
  });
});
