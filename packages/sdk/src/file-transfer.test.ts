import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { createNodeFileByteTransport } from "./file-transfer.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

async function fixtureServer(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
): Promise<{ origin: string; close: () => Promise<void> }> {
  const server = createServer(handler);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("fixture listen failed");
  const close = () => new Promise<void>((resolve) => server.close(() => resolve()));
  cleanups.push(close);
  return { origin: `http://127.0.0.1:${address.port}`, close };
}

describe("Node file byte transport", () => {
  test.each(["file:///tmp/stolen", "ftp://files.example/object", "https://user:pass@x.test/a"])(
    "rejects an unsafe presigned URL: %s",
    async (url) => {
      const transport = createNodeFileByteTransport();
      await expect(
        transport.uploadPart({ url, bytes: new Uint8Array([1]), checksumSha256: "AA==" }),
      ).rejects.toThrow(/presigned URL/);
    },
  );

  test("uploads bytes with checksum but never an OrgSpace authorization header", async () => {
    let observedHeaders: IncomingMessage["headers"] | undefined;
    const fixture = await fixtureServer((request, response) => {
      observedHeaders = request.headers;
      response.setHeader("etag", '"part-etag"');
      response.end();
    });
    const result = await createNodeFileByteTransport().uploadPart({
      url: `${fixture.origin}/part?signature=one`,
      bytes: new Uint8Array([1, 2, 3]),
      checksumSha256: "AQID",
    });
    expect(result).toEqual({ etag: '"part-etag"' });
    expect(observedHeaders?.authorization).toBeUndefined();
    expect(observedHeaders?.["x-amz-checksum-sha256"]).toBe("AQID");
  });

  test("rejects a cross-origin redirect without writing the destination", async () => {
    const target = await fixtureServer((_request, response) => response.end("stolen"));
    const source = await fixtureServer((_request, response) => {
      response.statusCode = 302;
      response.setHeader("location", `${target.origin}/object`);
      response.end();
    });
    const directory = await mkdtemp(join(tmpdir(), "torg-transfer-"));
    cleanups.push(() => rm(directory, { recursive: true }));
    const destination = join(directory, "download.bin");
    await expect(
      createNodeFileByteTransport().download({
        url: `${source.origin}/signed`,
        destination,
        expectedSha256: "0".repeat(64),
      }),
    ).rejects.toThrow(/cross-origin redirect/);
    expect(existsSync(destination)).toBe(false);
  });

  test("atomically publishes only a checksum-verified download", async () => {
    const bytes = Buffer.from("verified bytes");
    const fixture = await fixtureServer((_request, response) => response.end(bytes));
    const directory = await mkdtemp(join(tmpdir(), "torg-transfer-"));
    cleanups.push(() => rm(directory, { recursive: true }));
    const destination = join(directory, "download.bin");
    await createNodeFileByteTransport().download({
      url: `${fixture.origin}/signed`,
      destination,
      expectedSha256: createHash("sha256").update(bytes).digest("hex"),
    });
    expect(await readFile(destination)).toEqual(bytes);
    expect(existsSync(`${destination}.part`)).toBe(false);
  });

  test("never overwrites an existing destination", async () => {
    const bytes = Buffer.from("new bytes");
    const fixture = await fixtureServer((_request, response) => response.end(bytes));
    const directory = await mkdtemp(join(tmpdir(), "torg-transfer-"));
    cleanups.push(() => rm(directory, { recursive: true }));
    const destination = join(directory, "download.bin");
    await writeFile(destination, "keep me");
    await expect(
      createNodeFileByteTransport().download({
        url: `${fixture.origin}/signed`,
        destination,
        expectedSha256: createHash("sha256").update(bytes).digest("hex"),
      }),
    ).rejects.toThrow(/destination already exists/);
    expect(await readFile(destination, "utf8")).toBe("keep me");
  });
});
