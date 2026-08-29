import { createHash, randomUUID } from "node:crypto";
import { link, lstat, open, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface FileByteTransport {
  uploadPart(input: {
    url: string;
    bytes: Uint8Array;
    checksumSha256: string;
  }): Promise<{ etag: string }>;
  download(input: { url: string; destination: string; expectedSha256: string }): Promise<void>;
}

function presignedUrl(raw: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("presigned URL must be an absolute HTTP(S) URL");
  }
  if (
    !["http:", "https:"].includes(parsed.protocol) ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.hash !== ""
  ) {
    throw new Error(
      "presigned URL must be an absolute HTTP(S) URL without credentials or fragment",
    );
  }
  return parsed;
}

async function fetchPresigned(
  rawUrl: string,
  init: RequestInit,
  maximumRedirects = 3,
): Promise<Response> {
  const initial = presignedUrl(rawUrl);
  let current = initial;
  for (let redirectCount = 0; redirectCount <= maximumRedirects; redirectCount += 1) {
    const response = await fetch(current, { ...init, redirect: "manual" });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get("location");
    if (location === null) throw new Error("presigned redirect omitted its location");
    const redirected = presignedUrl(new URL(location, current).toString());
    if (redirected.origin !== initial.origin) {
      throw new Error("presigned request refused a cross-origin redirect");
    }
    current = redirected;
  }
  throw new Error("presigned request exceeded the redirect limit");
}

export function createNodeFileByteTransport(): FileByteTransport {
  return {
    async uploadPart(input) {
      const response = await fetchPresigned(input.url, {
        method: "PUT",
        headers: {
          "content-type": "application/octet-stream",
          "x-amz-checksum-sha256": input.checksumSha256,
        },
        body: Uint8Array.from(input.bytes).buffer,
      });
      if (!response.ok) throw new Error(`presigned upload failed with status ${response.status}`);
      const etag = response.headers.get("etag");
      if (etag === null || etag.trim() === "") throw new Error("presigned upload omitted ETag");
      return { etag };
    },

    async download(input) {
      if (!/^[a-f0-9]{64}$/.test(input.expectedSha256)) {
        throw new Error("expected download SHA-256 must be lowercase hexadecimal");
      }
      try {
        await lstat(input.destination);
        throw new Error("download destination already exists");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      const response = await fetchPresigned(input.url, { method: "GET" });
      if (!response.ok) throw new Error(`presigned download failed with status ${response.status}`);
      if (response.body === null) throw new Error("presigned download returned no body");

      const temporary = join(dirname(input.destination), `.${randomUUID()}.part`);
      const handle = await open(temporary, "wx", 0o600);
      const checksum = createHash("sha256");
      try {
        for await (const chunk of response.body) {
          const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
          checksum.update(bytes);
          await handle.write(bytes);
        }
        await handle.sync();
        await handle.close();
        if (checksum.digest("hex") !== input.expectedSha256) {
          throw new Error("download SHA-256 mismatch");
        }
        try {
          await link(temporary, input.destination);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "EEXIST") {
            throw new Error("download destination already exists", { cause: error });
          }
          throw error;
        }
        await unlink(temporary);
      } catch (error) {
        await handle.close().catch(() => undefined);
        await unlink(temporary).catch(() => undefined);
        throw error;
      }
    },
  };
}
