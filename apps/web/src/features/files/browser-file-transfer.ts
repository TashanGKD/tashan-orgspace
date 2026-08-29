import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function sha256Base64(bytes: Uint8Array): string {
  return base64(sha256(bytes));
}

export async function sha256File(file: Blob, chunkSize: number): Promise<string> {
  const hash = sha256.create();
  for (let offset = 0; offset < file.size; offset += chunkSize) {
    hash.update(new Uint8Array(await file.slice(offset, offset + chunkSize).arrayBuffer()));
  }
  return bytesToHex(hash.digest());
}

export async function putPresignedPart(input: {
  url: string;
  bytes: Uint8Array;
  checksumSha256: string;
}): Promise<{ etag: string }> {
  const url = new URL(input.url);
  if (!["http:", "https:"].includes(url.protocol) || url.username !== "" || url.password !== "") {
    throw new Error("上传地址无效");
  }
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: "PUT",
        redirect: "error",
        headers: {
          "content-type": "application/octet-stream",
          "x-amz-checksum-sha256": input.checksumSha256,
        },
        body: Uint8Array.from(input.bytes).buffer,
      });
      if (!response.ok) throw new Error(`上传分片失败（${response.status}）`);
      const etag = response.headers.get("etag");
      if (etag === null || etag === "") throw new Error("上传响应缺少 ETag");
      return { etag };
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error("上传分片失败", { cause: lastError });
}

export async function downloadVerified(input: {
  url: string;
  expectedSha256: string;
  fileName: string;
}): Promise<void> {
  const url = new URL(input.url);
  if (!["http:", "https:"].includes(url.protocol) || url.username !== "" || url.password !== "") {
    throw new Error("下载地址无效");
  }
  const response = await fetch(url, { redirect: "error" });
  if (!response.ok) throw new Error(`下载失败（${response.status}）`);
  const blob = await response.blob();
  const actual = await sha256File(blob, 8 * 1024 * 1024);
  if (actual !== input.expectedSha256) throw new Error("下载文件校验失败");
  const objectUrl = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = input.fileName;
    anchor.click();
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
