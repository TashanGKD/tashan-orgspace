import { describe, expect, test } from "vitest";
import type { S3Client } from "@aws-sdk/client-s3";

import {
  parseObjectStoreConfig,
  S3FileDataStore,
  sha256Stream,
  temporaryObjectKey,
  versionObjectKey,
} from "./index.js";

const local = {
  endpoint: "http://minio:9000",
  publicOrigin: "http://127.0.0.1:59000",
  region: "us-east-1",
  bucket: "orgspace-files",
  accessKeyId: "test-access",
  secretAccessKey: "test-secret-value",
  forcePathStyle: true,
};

describe("object store configuration", () => {
  test("accepts explicit local endpoints", () => {
    expect(parseObjectStoreConfig(local, "test")).toEqual(local);
  });

  test("rejects insecure or loopback public origins in production", () => {
    expect(() =>
      parseObjectStoreConfig(
        { ...local, publicOrigin: "http://files.orgspace.tashan.chat" },
        "production",
      ),
    ).toThrow(/production S3 public origin must use HTTPS/);
    expect(() =>
      parseObjectStoreConfig({ ...local, publicOrigin: "https://127.0.0.1:59000" }, "production"),
    ).toThrow(/production S3 public origin must not use loopback/);
  });

  test("rejects credentials, paths, queries and fragments in either origin", () => {
    for (const endpoint of [
      "http://user:secret@minio:9000",
      "http://minio:9000/private",
      "http://minio:9000?bucket=other",
      "http://minio:9000#fragment",
    ]) {
      expect(() => parseObjectStoreConfig({ ...local, endpoint }, "test")).toThrow(
        /S3 endpoint must be an HTTP\(S\) origin without credentials, path, query or fragment/,
      );
    }
  });

  test("rejects an empty bucket and identical production endpoints", () => {
    expect(() => parseObjectStoreConfig({ ...local, bucket: "" }, "test")).toThrow(
      /S3 bucket is required/,
    );
    expect(() =>
      parseObjectStoreConfig(
        {
          ...local,
          endpoint: "https://files.orgspace.tashan.chat",
          publicOrigin: "https://files.orgspace.tashan.chat",
        },
        "production",
      ),
    ).toThrow(/production S3 internal and public origins must differ/);
  });
});

describe("object identity and checksums", () => {
  test("derives opaque keys only from UUIDs", () => {
    expect(temporaryObjectKey("746fb70b-a27e-4a78-a231-aa55ef8c343e")).toBe(
      "temporary/746fb70b-a27e-4a78-a231-aa55ef8c343e",
    );
    expect(versionObjectKey("35f503c2-a5d7-4250-a337-4f4fd03cf8df")).toBe(
      "versions/35f503c2-a5d7-4250-a337-4f4fd03cf8df",
    );
    expect(() => temporaryObjectKey("../../secret.txt")).toThrow(/object ID must be a UUID/);
    expect(() => versionObjectKey("report.pdf")).toThrow(/object ID must be a UUID/);
  });

  test("hashes an async byte stream without string coercion", async () => {
    async function* bytes() {
      yield new Uint8Array([0, 1, 2]);
      yield new Uint8Array([253, 254, 255]);
    }
    await expect(sha256Stream(bytes())).resolves.toBe(
      "3f2d1552cdc7483f40dd720c80b900225dfecfd5cae7cd168d79ab6ee5959885",
    );
  });
});

describe("S3 file data plane", () => {
  test("uses opaque multipart commands and attachment-only downloads", async () => {
    const commands: unknown[] = [];
    const internal = {
      send: async (command: unknown) => {
        commands.push(command);
        return commands.length === 1 ? { UploadId: "opaque-upload" } : {};
      },
    };
    const signed: unknown[] = [];
    const store = new S3FileDataStore({
      internalClient: internal as unknown as S3Client,
      presignClient: internal as unknown as S3Client,
      bucket: "orgspace-files",
      presign: async (_client, command) => {
        signed.push(command);
        return "https://files.example/signed";
      },
    });
    await expect(
      store.createMultipart({
        key: "temporary/746fb70b-a27e-4a78-a231-aa55ef8c343e",
        contentType: "application/octet-stream",
      }),
    ).resolves.toBe("opaque-upload");
    await expect(
      store.sign({
        objectKey: "versions/35f503c2-a5d7-4250-a337-4f4fd03cf8df",
        fileName: 'report".html',
        contentType: "text/html",
        expiresInSeconds: 300,
      }),
    ).resolves.toBe("https://files.example/signed");
    expect(JSON.stringify(signed)).toContain("attachment");
    expect(JSON.stringify(signed)).toContain("application/octet-stream");
  });
});
