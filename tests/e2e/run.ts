import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createServer } from "node:net";

import { migrateDatabase, resetTestDatabase } from "../../apps/api/src/db/migrate.js";

const composePassword = "phase0-container-smoke-only";
const composeFile = "deploy/compose.local.yml";

async function reserveLoopbackPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    server.close();
    throw new Error("E2E failed to reserve a loopback port");
  }
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
  return address.port;
}

function assertLoopback(raw: string, label: string): void {
  const host = new URL(raw).hostname.toLowerCase();
  if (!["127.0.0.1", "localhost", "[::1]"].includes(host)) {
    throw new Error(`E2E ${label} URL must use loopback`);
  }
}

async function run(
  command: string,
  args: string[],
  environment: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: environment,
    shell: false,
    stdio: ["ignore", "inherit", "inherit"],
  });
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
  if (exitCode !== 0) throw new Error(`${command} ${args.join(" ")} exited ${exitCode}`);
}

async function stopChild(child: ChildProcess | undefined): Promise<void> {
  if (child === undefined || child.exitCode !== null) return;
  child.kill("SIGTERM");
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  const deadline = new Promise<void>((resolve) => {
    setTimeout(() => {
      if (child.exitCode === null) child.kill("SIGKILL");
      resolve();
    }, 5_000).unref();
  });
  await Promise.race([exited, deadline]);
}

async function startApi(environment: NodeJS.ProcessEnv): Promise<{
  child: ChildProcess;
  apiUrl: string;
}> {
  const child = spawn("pnpm", ["exec", "tsx", "tests/e2e/support/api-process.ts"], {
    cwd: process.cwd(),
    env: environment,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stderr?.pipe(process.stderr);
  child.stdout?.setEncoding("utf8");
  const apiUrl = await new Promise<string>((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => reject(new Error("E2E API startup timed out")), 10_000);
    child.once("error", reject);
    child.once("exit", (code) => reject(new Error(`E2E API exited before ready (${code})`)));
    child.stdout?.on("data", (chunk: string) => {
      output += chunk;
      const match = /E2E_API_READY (http:\/\/127\.0\.0\.1:[0-9]+)/.exec(output);
      if (match?.[1] !== undefined) {
        clearTimeout(timeout);
        resolve(match[1]);
      }
    });
  });
  assertLoopback(apiUrl, "API");
  return { child, apiUrl };
}

async function waitForHealth(apiUrl: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(new URL("/v1/health", apiUrl));
      if (response.ok) return;
      lastError = new Error(`health returned ${response.status}: ${await response.text()}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("E2E API health deadline exceeded", { cause: lastError });
}

const temporaryDirectory = await mkdtemp(join(tmpdir(), "torg-e2e-"));
const codeFile = join(temporaryDirectory, "verification-codes.json");
const runId = randomUUID();
const postgresPort = await reserveLoopbackPort();
const redisPort = await reserveLoopbackPort();
const s3Port = await reserveLoopbackPort();
const databaseUrl = `postgresql://orgspace:${composePassword}@127.0.0.1:${postgresPort}/orgspace_e2e_test`;
const redisUrl = `redis://127.0.0.1:${redisPort}`;
const s3Url = `http://127.0.0.1:${s3Port}`;
const composeProject = `tashan-orgspace-e2e-${process.pid}`;
const minioRootUser = `e2eroot${process.pid}`;
const minioRootPassword = `e2e-minio-root-password-${runId}`;
const s3AccessKeyId = `e2eapp${process.pid}`;
const s3SecretAccessKey = `e2e-s3-app-secret-${runId}`;
const composeEnvironment = {
  ...process.env,
  ORGSPACE_LOCAL_POSTGRES_PASSWORD: composePassword,
  ORGSPACE_LOCAL_POSTGRES_PORT: String(postgresPort),
  ORGSPACE_LOCAL_REDIS_PORT: String(redisPort),
  ORGSPACE_LOCAL_S3_PORT: String(s3Port),
  MINIO_ROOT_USER: minioRootUser,
  MINIO_ROOT_PASSWORD: minioRootPassword,
  S3_ACCESS_KEY_ID: s3AccessKeyId,
  S3_SECRET_ACCESS_KEY: s3SecretAccessKey,
};
assertLoopback(databaseUrl, "database");
assertLoopback(redisUrl, "Redis");
assertLoopback(s3Url, "S3");
let api: ChildProcess | undefined;
let worker: ChildProcess | undefined;

try {
  await run(
    "docker",
    [
      "compose",
      "-f",
      composeFile,
      "-p",
      composeProject,
      "up",
      "-d",
      "--wait",
      "postgres",
      "redis",
      "minio",
    ],
    composeEnvironment,
  );
  await run(
    "docker",
    ["compose", "-f", composeFile, "-p", composeProject, "run", "--rm", "minio-bootstrap"],
    composeEnvironment,
  );
  await resetTestDatabase(databaseUrl);
  await migrateDatabase(databaseUrl);
  const serviceEnvironment = {
    ...process.env,
    E2E_DATABASE_URL: databaseUrl,
    E2E_REDIS_URL: redisUrl,
    E2E_CODE_FILE: codeFile,
    E2E_RUN_ID: runId,
  };
  const started = await startApi(serviceEnvironment);
  api = started.child;
  await waitForHealth(started.apiUrl);
  worker = spawn("pnpm", ["--filter", "@tashan/worker", "start"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      FILE_STORAGE_ENABLED: "true",
      WORKER_ID: `e2e-${runId}`,
      OUTBOX_POLL_MILLISECONDS: "50",
      S3_ENDPOINT: s3Url,
      S3_PUBLIC_ORIGIN: s3Url,
      S3_REGION: "us-east-1",
      S3_BUCKET: "orgspace-files",
      S3_ACCESS_KEY_ID: s3AccessKeyId,
      S3_SECRET_ACCESS_KEY: s3SecretAccessKey,
      S3_FORCE_PATH_STYLE: "true",
    },
    shell: false,
    stdio: ["ignore", "inherit", "inherit"],
  });
  await run("pnpm", ["exec", "vitest", "run", "--config", "vitest.e2e.config.ts"], {
    ...serviceEnvironment,
    E2E_API_URL: started.apiUrl,
  });
} finally {
  await stopChild(worker);
  await stopChild(api);
  await run(
    "docker",
    ["compose", "-f", composeFile, "-p", composeProject, "down", "--volumes"],
    composeEnvironment,
  ).catch((error: unknown) => {
    process.stderr.write(`E2E compose cleanup failed: ${String(error)}\n`);
  });
  await rm(temporaryDirectory, { recursive: true });
}
