import { createHash } from "node:crypto";
import { open, stat } from "node:fs/promises";
import { basename } from "node:path";

import type { Command } from "commander";

import type { CapabilityId } from "@tashan/capabilities";
import type { OrgSpaceClient } from "@tashan/sdk";
import type { FileByteTransport } from "@tashan/sdk/file-transfer";

import {
  requireConfirmationAndIdempotency,
  requireIdempotency,
  type CommandContext,
} from "./context.js";

export const fileCapabilityIds = [
  "file.list",
  "file.read",
  "file.search",
  "file.folder.create",
  "file.move",
  "file.trash",
  "file.restore",
  "file.delete",
  "file.download.create",
  "file.version.list",
  "file.version.restore",
  "file.upload.list",
  "file.upload.read",
  "file.upload.create",
  "file.upload.parts.create",
  "file.upload.complete",
  "file.upload.cancel",
] as const satisfies readonly CapabilityId[];

async function uploadWithRetry(
  transport: FileByteTransport,
  input: Parameters<FileByteTransport["uploadPart"]>[0],
): Promise<{ etag: string }> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await transport.uploadPart(input);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

async function transferUpload(input: {
  client: OrgSpaceClient;
  byteTransport: FileByteTransport;
  spaceId: string;
  uploadId: string;
  path: string;
  idempotencyKey: string;
}): Promise<unknown> {
  const state = await input.client.readUpload(input.spaceId, input.uploadId);
  const session = state.uploadSession;
  const file = await open(input.path, "r");
  try {
    const metadata = await file.stat();
    if (!metadata.isFile() || metadata.size !== session.expectedSizeBytes) {
      throw new Error("local file size no longer matches the upload session");
    }
    const confirmed = new Map(state.uploadedParts.map((part) => [part.partNumber, part]));
    const wholeChecksum = createHash("sha256");
    const completed = [] as Array<{ partNumber: number; etag: string; checksumSha256: string }>;
    for (let partNumber = 1; partNumber <= session.partCount; partNumber += 1) {
      const offset = (partNumber - 1) * session.partSizeBytes;
      const length = Math.min(session.partSizeBytes, session.expectedSizeBytes - offset);
      const bytes = Buffer.allocUnsafe(length);
      const read = await file.read(bytes, 0, length, offset);
      if (read.bytesRead !== length) throw new Error("local file changed while it was being read");
      wholeChecksum.update(bytes);
      const checksumSha256 = createHash("sha256").update(bytes).digest("base64");
      const existing = confirmed.get(partNumber);
      if (existing !== undefined) {
        if (existing.sizeBytes !== length || existing.checksumSha256 !== checksumSha256) {
          throw new Error("server-confirmed upload part does not match the local file");
        }
        completed.push({ partNumber, etag: existing.etag, checksumSha256 });
        continue;
      }
      const urls = await input.client.createUploadPartUrls(
        input.spaceId,
        input.uploadId,
        { partNumbers: [partNumber] },
        { idempotencyKey: `${input.idempotencyKey}:part-url:${partNumber}` },
      );
      const url = urls.items.find((item) => item.partNumber === partNumber)?.url;
      if (url === undefined) throw new Error("server omitted the requested upload part URL");
      const uploaded = await uploadWithRetry(input.byteTransport, {
        url,
        bytes,
        checksumSha256,
      });
      completed.push({ partNumber, etag: uploaded.etag, checksumSha256 });
    }
    return input.client.completeUpload(
      input.spaceId,
      input.uploadId,
      { parts: completed, expectedSha256: wholeChecksum.digest("hex") },
      { idempotencyKey: `${input.idempotencyKey}:complete` },
    );
  } finally {
    await file.close();
  }
}

export function registerFileCommands(program: Command, context: CommandContext): void {
  const file = program.command("file").description("List, upload, download and manage files");
  file.action(() => context.output.stdout(file.helpInformation()));
  const list = file.command("list").requiredOption("--space <id>").requiredOption("--parent <id>");
  list.action(async (o: { space: string; parent: string }) => {
    const result = await (
      await context.runtime()
    ).client.listFiles(o.space, { parentId: o.parent });
    context.emit(list, result, result.items.map((item) => `${item.id}\t${item.name}`).join("\n"));
  });
  const get = file.command("get").requiredOption("--space <id>").requiredOption("--file <id>");
  get.action(async (o: { space: string; file: string }) => {
    const result = await (await context.runtime()).client.readFile(o.space, o.file);
    context.emit(get, result, `${result.entry.id}\t${result.entry.name}`);
  });
  const search = file
    .command("search")
    .requiredOption("--space <id>")
    .requiredOption("--query <text>");
  search.action(async (o: { space: string; query: string }) => {
    const result = await (await context.runtime()).client.searchFiles(o.space, { query: o.query });
    context.emit(search, result, result.items.map((item) => `${item.id}\t${item.name}`).join("\n"));
  });
  const mkdir = file
    .command("mkdir")
    .requiredOption("--space <id>")
    .requiredOption("--parent <id>")
    .requiredOption("--name <name>")
    .requiredOption("--access <organization_public|restricted>")
    .option("--idempotency-key <key>");
  mkdir.action(
    async (o: {
      space: string;
      parent: string;
      name: string;
      access: string;
      idempotencyKey?: string;
    }) => {
      const key = requireIdempotency(context, o.idempotencyKey);
      const result = await (
        await context.runtime()
      ).client.createFolder(
        o.space,
        { parentId: o.parent, name: o.name, accessScope: o.access, grants: [] },
        { idempotencyKey: key },
      );
      context.emit(mkdir, result, `Created folder ${result.entry.name}`);
    },
  );
  const move = file
    .command("move")
    .requiredOption("--space <id>")
    .requiredOption("--file <id>")
    .requiredOption("--parent <id>")
    .requiredOption("--expected-version <n>")
    .option("--name <name>")
    .option("--idempotency-key <key>");
  move.action(
    async (o: {
      space: string;
      file: string;
      parent: string;
      expectedVersion: string;
      name?: string;
      idempotencyKey?: string;
    }) => {
      const key = requireIdempotency(context, o.idempotencyKey);
      const result = await (
        await context.runtime()
      ).client.moveFile(
        o.space,
        o.file,
        {
          targetParentId: o.parent,
          expectedVersion: Number(o.expectedVersion),
          ...(o.name === undefined ? {} : { name: o.name }),
        },
        { idempotencyKey: key },
      );
      context.emit(move, result, `Moved ${result.entry.name}`);
    },
  );
  const upload = file
    .command("upload <local-path>")
    .requiredOption("--space <id>")
    .requiredOption("--parent <id>")
    .option("--target-file <id>")
    .option("--content-type <type>", "MIME type", "application/octet-stream")
    .option("--idempotency-key <key>");
  upload.action(
    async (
      path: string,
      o: {
        space: string;
        parent: string;
        targetFile?: string;
        contentType: string;
        idempotencyKey?: string;
      },
    ) => {
      const key = requireIdempotency(context, o.idempotencyKey);
      const runtime = await context.runtime();
      const metadata = await stat(path);
      if (!metadata.isFile()) context.usage("local-path must be a regular file");
      const created = await runtime.client.createUpload(
        o.space,
        {
          parentId: o.parent,
          ...(o.targetFile === undefined ? {} : { targetFileId: o.targetFile }),
          fileName: basename(path),
          expectedSizeBytes: metadata.size,
          contentType: o.contentType,
        },
        { idempotencyKey: key },
      );
      const result = await transferUpload({
        client: runtime.client,
        byteTransport: runtime.fileByteTransport,
        spaceId: o.space,
        uploadId: created.uploadSession.id,
        path,
        idempotencyKey: key,
      });
      context.emit(
        upload,
        result,
        `Uploaded ${basename(path)}; server verification is in progress`,
      );
    },
  );
  const download = file
    .command("download")
    .requiredOption("--space <id>")
    .requiredOption("--file <id>")
    .requiredOption("--output <path>")
    .option("--idempotency-key <key>");
  download.action(
    async (o: { space: string; file: string; output: string; idempotencyKey?: string }) => {
      const key = requireIdempotency(context, o.idempotencyKey);
      const runtime = await context.runtime();
      const signed = await runtime.client.createFileDownload(o.space, o.file, {
        idempotencyKey: key,
      });
      await runtime.fileByteTransport.download({
        url: signed.url,
        destination: o.output,
        expectedSha256: signed.checksumSha256,
      });
      context.emit(
        download,
        { fileName: signed.fileName, destination: o.output },
        `Downloaded ${signed.fileName} to ${o.output}`,
      );
    },
  );
  const versions = file
    .command("versions")
    .requiredOption("--space <id>")
    .requiredOption("--file <id>");
  versions.action(async (o: { space: string; file: string }) => {
    const result = await (await context.runtime()).client.listFileVersions(o.space, o.file);
    context.emit(
      versions,
      result,
      result.items.map((item) => `${item.versionNumber}\t${item.id}`).join("\n"),
    );
  });
  const versionRestore = file
    .command("version-restore")
    .requiredOption("--space <id>")
    .requiredOption("--file <id>")
    .requiredOption("--version-id <id>")
    .requiredOption("--expected-version <n>")
    .option("--yes")
    .option("--idempotency-key <key>");
  versionRestore.action(
    async (o: {
      space: string;
      file: string;
      versionId: string;
      expectedVersion: string;
      yes?: boolean;
      idempotencyKey?: string;
    }) => {
      const key = requireConfirmationAndIdempotency(context, o);
      const result = await (
        await context.runtime()
      ).client.restoreFileVersion(
        o.space,
        o.file,
        o.versionId,
        { expectedVersion: Number(o.expectedVersion) },
        { idempotencyKey: key },
      );
      context.emit(versionRestore, result, `Restored version ${o.versionId}`);
    },
  );
  const trash = file
    .command("trash")
    .requiredOption("--space <id>")
    .requiredOption("--file <id>")
    .option("--yes")
    .option("--idempotency-key <key>");
  trash.action(
    async (o: { space: string; file: string; yes?: boolean; idempotencyKey?: string }) => {
      const key = requireConfirmationAndIdempotency(context, o);
      const result = await (
        await context.runtime()
      ).client.trashFile(o.space, o.file, { idempotencyKey: key });
      context.emit(trash, result, `Moved to trash; scheduled deletion ${result.expiresAt}`);
    },
  );
  const restore = file
    .command("restore")
    .requiredOption("--space <id>")
    .requiredOption("--file <id>")
    .requiredOption("--expected-version <n>")
    .option("--parent <id>")
    .option("--name <name>")
    .option("--idempotency-key <key>");
  restore.action(
    async (o: {
      space: string;
      file: string;
      expectedVersion: string;
      parent?: string;
      name?: string;
      idempotencyKey?: string;
    }) => {
      const key = requireIdempotency(context, o.idempotencyKey);
      const result = await (
        await context.runtime()
      ).client.restoreFile(
        o.space,
        o.file,
        {
          expectedVersion: Number(o.expectedVersion),
          ...(o.parent === undefined ? {} : { parentId: o.parent }),
          ...(o.name === undefined ? {} : { name: o.name }),
        },
        { idempotencyKey: key },
      );
      context.emit(restore, result, `Restored ${result.entry.name}`);
    },
  );
  const remove = file
    .command("delete")
    .description("Permanently delete the entry and all file versions")
    .requiredOption("--space <id>")
    .requiredOption("--file <id>")
    .option("--yes")
    .option("--idempotency-key <key>");
  remove.action(
    async (o: { space: string; file: string; yes?: boolean; idempotencyKey?: string }) => {
      const key = requireConfirmationAndIdempotency(context, o);
      const result = await (
        await context.runtime()
      ).client.deleteFile(o.space, o.file, { idempotencyKey: key });
      context.emit(remove, result, `Scheduled permanent deletion of ${o.file} and all versions`);
    },
  );

  const uploadGroup = program.command("upload").description("Resume and manage uploads");
  uploadGroup.action(() => context.output.stdout(uploadGroup.helpInformation()));
  const uploadList = uploadGroup.command("list").requiredOption("--space <id>");
  uploadList.action(async (o: { space: string }) => {
    const result = await (await context.runtime()).client.listUploads(o.space);
    context.emit(
      uploadList,
      result,
      result.items.map((item) => `${item.id}\t${item.status}\t${item.fileName}`).join("\n"),
    );
  });
  const resume = uploadGroup
    .command("resume <local-path>")
    .requiredOption("--space <id>")
    .requiredOption("--upload <id>")
    .option("--idempotency-key <key>");
  resume.action(
    async (path: string, o: { space: string; upload: string; idempotencyKey?: string }) => {
      const key = requireIdempotency(context, o.idempotencyKey);
      const runtime = await context.runtime();
      const result = await transferUpload({
        client: runtime.client,
        byteTransport: runtime.fileByteTransport,
        spaceId: o.space,
        uploadId: o.upload,
        path,
        idempotencyKey: key,
      });
      context.emit(
        resume,
        result,
        `Resumed upload ${o.upload}; server verification is in progress`,
      );
    },
  );
  const cancel = uploadGroup
    .command("cancel")
    .requiredOption("--space <id>")
    .requiredOption("--upload <id>")
    .option("--yes")
    .option("--idempotency-key <key>");
  cancel.action(
    async (o: { space: string; upload: string; yes?: boolean; idempotencyKey?: string }) => {
      const key = requireConfirmationAndIdempotency(context, o);
      const result = await (
        await context.runtime()
      ).client.cancelUpload(o.space, o.upload, { idempotencyKey: key });
      context.emit(cancel, result, `Cancelled upload ${o.upload}`);
    },
  );
}
