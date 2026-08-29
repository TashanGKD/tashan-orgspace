import { useQuery, useQueryClient } from "@tanstack/react-query";
import { UploadCloud } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";

import type { OrgSpaceClient } from "@tashan/sdk";

import { Button, Sheet, SheetContent, SheetTitle } from "../../design-system/primitives/index.js";
import { putPresignedPart, sha256Base64, sha256File } from "./browser-file-transfer.js";

function mutationKey(prefix: string): string {
  return `web-${prefix}-${crypto.randomUUID()}`;
}

async function waitForUpload(sdk: OrgSpaceClient, spaceId: string, uploadId: string) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const state = await sdk.readUpload(spaceId, uploadId);
    if (state.uploadSession.status === "completed") return state.uploadSession;
    if (["failed", "cancelled", "expired"].includes(state.uploadSession.status)) {
      throw new Error("文件校验失败，请重新上传");
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("文件仍在校验，可稍后在上传记录中查看");
}

export function FileUploadDialog({
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
  const [file, setFile] = useState<File>();
  const [targetFileId, setTargetFileId] = useState("");
  const [resumeUploadId, setResumeUploadId] = useState("");
  const [state, setState] = useState<"idle" | "uploading" | "verifying" | "done" | "error">("idle");
  const [error, setError] = useState("");
  const locked = useRef(false);
  const uploads = useQuery({
    queryKey: ["files", spaceId, "uploads"],
    queryFn: ({ signal }) => sdk.listUploads(spaceId, signal),
    enabled: open,
  });

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (file === undefined || locked.current) return;
    locked.current = true;
    setError("");
    setState("uploading");
    const rootKey = mutationKey("upload");
    try {
      const uploadId =
        resumeUploadId.trim() === ""
          ? (
              await sdk.createUpload(
                spaceId,
                {
                  parentId,
                  fileName: file.name,
                  expectedSizeBytes: file.size,
                  contentType: file.type || "application/octet-stream",
                  ...(targetFileId.trim() === "" ? {} : { targetFileId: targetFileId.trim() }),
                },
                { idempotencyKey: rootKey },
              )
            ).uploadSession.id
          : resumeUploadId.trim();
      const server = await sdk.readUpload(spaceId, uploadId);
      const confirmed = new Map(server.uploadedParts.map((part) => [part.partNumber, part]));
      const completed: Array<{ partNumber: number; etag: string; checksumSha256: string }> = [];
      for (let partNumber = 1; partNumber <= server.uploadSession.partCount; partNumber += 1) {
        const start = (partNumber - 1) * server.uploadSession.partSizeBytes;
        const bytes = new Uint8Array(
          await file.slice(start, start + server.uploadSession.partSizeBytes).arrayBuffer(),
        );
        const checksumSha256 = sha256Base64(bytes);
        const existing = confirmed.get(partNumber);
        if (existing !== undefined) {
          if (
            existing.sizeBytes !== bytes.byteLength ||
            existing.checksumSha256 !== checksumSha256
          ) {
            throw new Error("本地文件与已上传分片不一致");
          }
          completed.push({ partNumber, etag: existing.etag, checksumSha256 });
          continue;
        }
        const signed = await sdk.createUploadPartUrls(
          spaceId,
          uploadId,
          { partNumbers: [partNumber] },
          { idempotencyKey: `${rootKey}:part:${partNumber}` },
        );
        const url = signed.items.find((item) => item.partNumber === partNumber)?.url;
        if (url === undefined) throw new Error("服务器未返回上传地址");
        const uploaded = await putPresignedPart({ url, bytes, checksumSha256 });
        completed.push({ partNumber, etag: uploaded.etag, checksumSha256 });
      }
      setState("verifying");
      await sdk.completeUpload(
        spaceId,
        uploadId,
        { parts: completed, expectedSha256: await sha256File(file, 8 * 1024 * 1024) },
        { idempotencyKey: `${rootKey}:complete` },
      );
      await waitForUpload(sdk, spaceId, uploadId);
      await queryClient.invalidateQueries({
        predicate: (query) => query.queryKey.includes("files") && query.queryKey.includes(spaceId),
      });
      setState("done");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "上传失败");
      setState("error");
    } finally {
      locked.current = false;
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="resource-form-sheet file-upload-sheet">
        <SheetTitle>上传文件</SheetTitle>
        <form
          aria-label="上传文件"
          className="resource-sheet-form"
          onSubmit={(event) => void submit(event)}
        >
          <div className="resource-sheet-form-body">
            <label className="file-drop-field">
              <UploadCloud aria-hidden size={22} />
              <span>{file?.name ?? "选择要上传的文件"}</span>
              <input
                aria-label="选择文件"
                type="file"
                onChange={(event) => setFile(event.target.files?.[0])}
              />
            </label>
            <label>
              添加为已有文件的新版本（可选）
              <input
                placeholder="文件 ID"
                value={targetFileId}
                onChange={(event) => setTargetFileId(event.target.value)}
              />
            </label>
            <label>
              继续已有上传（可选）
              <input
                list="active-upload-sessions"
                placeholder="上传记录 ID"
                value={resumeUploadId}
                onChange={(event) => setResumeUploadId(event.target.value)}
              />
              <datalist id="active-upload-sessions">
                {uploads.data?.items
                  .filter((item) => item.status === "uploading")
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.fileName}
                    </option>
                  ))}
              </datalist>
            </label>
            {uploads.data?.items.some((item) => item.status === "uploading") ? (
              <section aria-label="未完成的上传" className="active-upload-list">
                <h3>未完成的上传</h3>
                {uploads.data.items
                  .filter((item) => item.status === "uploading")
                  .map((item) => (
                    <div key={item.id}>
                      <span>{item.fileName}</span>
                      <Button
                        size="small"
                        variant="quiet"
                        onClick={() => setResumeUploadId(item.id)}
                      >
                        继续
                      </Button>
                      <Button
                        size="small"
                        variant="quiet"
                        onClick={() => {
                          if (!window.confirm(`取消“${item.fileName}”的上传？`)) return;
                          void sdk
                            .cancelUpload(spaceId, item.id, {
                              idempotencyKey: mutationKey("upload-cancel"),
                            })
                            .then(() => uploads.refetch());
                        }}
                      >
                        取消
                      </Button>
                    </div>
                  ))}
              </section>
            ) : null}
            {state === "uploading" ? <p role="status">正在上传…</p> : null}
            {state === "verifying" ? <p role="status">正在校验文件…</p> : null}
            {state === "done" ? <p role="status">上传完成</p> : null}
            {state === "error" ? <p role="alert">{error}</p> : null}
          </div>
          <footer className="resource-sheet-form-actions">
            <Button
              disabled={file === undefined || state === "uploading" || state === "verifying"}
              type="submit"
            >
              开始上传
            </Button>
          </footer>
        </form>
      </SheetContent>
    </Sheet>
  );
}
