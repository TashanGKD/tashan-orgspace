import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";

import { LoginResponse, RegisterResponse, VerificationSendResponse } from "@tashan/contracts";

const password = "CorrectHorseBattery9";
let idempotencySequence = 0;

export interface VerifiedAccount {
  accountId: string;
  displayName: string;
  password: string;
  phone: string;
}

export function e2eEnvironment() {
  const apiUrl = required("E2E_API_URL");
  const databaseUrl = required("E2E_DATABASE_URL");
  const codeFile = required("E2E_CODE_FILE");
  assertLoopbackUrl(apiUrl, "API");
  assertLoopbackUrl(databaseUrl, "database");
  return { apiUrl, databaseUrl, codeFile };
}

function required(key: string): string {
  const value = process.env[key];
  if (value === undefined || value.trim() === "") throw new Error(`${key} is required`);
  return value;
}

function assertLoopbackUrl(raw: string, label: string): void {
  const host = new URL(raw).hostname.toLowerCase();
  if (!["127.0.0.1", "localhost", "[::1]"].includes(host)) {
    throw new Error(`E2E ${label} URL must use loopback`);
  }
}

function nextKey(prefix: string): string {
  idempotencySequence += 1;
  return `e2e-${prefix}-${idempotencySequence}`;
}

export async function e2eJsonRequest(
  path: string,
  init: RequestInit,
): Promise<{ status: number; body: unknown }> {
  const { apiUrl } = e2eEnvironment();
  const response = await fetch(new URL(path, apiUrl), init);
  return { status: response.status, body: await response.json() };
}

async function latestCode(phone: string): Promise<string> {
  const { codeFile } = e2eEnvironment();
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    try {
      const messages = JSON.parse(await readFile(codeFile, "utf8")) as {
        phone: string;
        code: string;
      }[];
      const code = messages.findLast((message) => message.phone === phone)?.code;
      if (code !== undefined) return code;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`verification code was not recorded for ${phone}`);
}

export async function sendVerificationChallenge(
  phone: string,
  purpose: "register" | "password_reset",
): Promise<{ challengeId: string; code: string }> {
  const started = await e2eJsonRequest("/v1/auth/verification/send", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": nextKey("verification-send"),
    },
    body: JSON.stringify({ phone, purpose }),
  });
  if (started.status !== 202) throw new Error(`verification send failed: ${started.status}`);
  const challenge = VerificationSendResponse.parse(started.body);
  return { challengeId: challenge.challengeId, code: await latestCode(phone) };
}

export async function registerAndVerify(label: string, phone: string): Promise<VerifiedAccount> {
  const challenge = await sendVerificationChallenge(phone, "register");
  const deviceId = crypto.randomUUID();
  const registered = await e2eJsonRequest("/v1/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": nextKey("register") },
    body: JSON.stringify({
      phone,
      challengeId: challenge.challengeId,
      code: challenge.code,
      password,
      device: {
        id: deviceId,
        name: `${label} registration client`,
        os: "e2e",
        architecture: "test",
        clientVersion: "0.0.0-e2e",
        channel: "cli",
      },
    }),
  });
  if (registered.status !== 201) throw new Error(`registration failed: ${registered.status}`);
  const registration = RegisterResponse.parse(registered.body);
  return {
    accountId: registration.account.id,
    displayName: registration.account.displayName,
    password,
    phone: registration.account.phone,
  };
}

export async function loginPhone(
  phone: string,
  loginPassword: string,
  deviceId: string,
  name: string,
): Promise<{ status: number; body: unknown }> {
  const result = await e2eJsonRequest("/v1/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", "x-torg-invocation-source": "cli" },
    body: JSON.stringify({
      phone,
      password: loginPassword,
      device: {
        id: deviceId,
        name,
        os: "e2e-os",
        architecture: "e2e-arch",
        clientVersion: "0.0.0-e2e",
        channel: "cli",
      },
    }),
  });
  if (result.status === 200) LoginResponse.parse(result.body);
  return result;
}

export async function runCliScenario<T>(input: Record<string, unknown>): Promise<T> {
  const child = spawn("pnpm", ["exec", "tsx", "tests/e2e/support/cli-scenario.ts"], {
    cwd: process.cwd(),
    env: { ...process.env, FORCE_COLOR: "0" },
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
  child.stdin.end(JSON.stringify({ ...input, apiUrl: e2eEnvironment().apiUrl }));
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
  if (exitCode !== 0) throw new Error(`CLI scenario failed (${exitCode}): ${stderr}`);
  return JSON.parse(stdout) as T;
}
