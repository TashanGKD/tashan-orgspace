import { S3Client } from "@aws-sdk/client-s3";
import { z } from "zod";

const RuntimeEnvironment = z.enum(["development", "test", "production"]);
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

const ObjectStoreConfigInput = z
  .object({
    endpoint: z.string().min(1),
    publicOrigin: z.string().min(1),
    region: z.string().trim().min(1).max(128),
    bucket: z.string().trim().min(1, "S3 bucket is required").max(63),
    accessKeyId: z.string().trim().min(1),
    secretAccessKey: z.string().min(1),
    forcePathStyle: z.boolean(),
  })
  .strict();

export interface ObjectStoreConfig {
  endpoint: string;
  publicOrigin: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

function parseOrigin(raw: string, label: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(
      `${label} must be an HTTP(S) origin without credentials, path, query or fragment`,
    );
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error(
      `${label} must be an HTTP(S) origin without credentials, path, query or fragment`,
    );
  }
  return url;
}

export function parseObjectStoreConfig(
  input: unknown,
  runtimeInput: "development" | "test" | "production",
): ObjectStoreConfig {
  const runtime = RuntimeEnvironment.parse(runtimeInput);
  const parsed = ObjectStoreConfigInput.parse(input);
  const endpoint = parseOrigin(parsed.endpoint, "S3 endpoint");
  const publicOrigin = parseOrigin(parsed.publicOrigin, "S3 public origin");

  if (runtime === "production") {
    if (publicOrigin.protocol !== "https:") {
      throw new Error("production S3 public origin must use HTTPS");
    }
    if (LOOPBACK_HOSTS.has(publicOrigin.hostname.toLowerCase())) {
      throw new Error("production S3 public origin must not use loopback");
    }
    if (endpoint.origin === publicOrigin.origin) {
      throw new Error("production S3 internal and public origins must differ");
    }
  }

  return {
    ...parsed,
    endpoint: endpoint.origin,
    publicOrigin: publicOrigin.origin,
  };
}

function client(config: ObjectStoreConfig, endpoint: string): S3Client {
  return new S3Client({
    endpoint,
    region: config.region,
    forcePathStyle: config.forcePathStyle,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
}

export function createInternalS3Client(config: ObjectStoreConfig): S3Client {
  return client(config, config.endpoint);
}

export function createPresignS3Client(config: ObjectStoreConfig): S3Client {
  return client(config, config.publicOrigin);
}
