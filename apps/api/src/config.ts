import { z } from "zod";

import { validateTrustedProxyCidrs } from "./http/trusted-proxy.js";

const RuntimeEnvironment = z.enum(["development", "test", "production"]);
const PhoneProvider = z.enum(["disabled", "aliyun"]);
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

function required(environment: NodeJS.ProcessEnv, key: string): string {
  const value = environment[key]?.trim();
  if (value === undefined || value === "") throw new Error(`${key} is required`);
  return value;
}

function commaList(raw: string | undefined): string[] {
  return raw === undefined
    ? []
    : raw
        .split(",")
        .map((value) => value.trim())
        .filter((value) => value !== "");
}

function validateCorsOrigins(origins: readonly string[], runtime: string): void {
  if (origins.length === 0 || origins.includes("*")) {
    throw new Error("CORS requires explicit origins and does not permit wildcard access");
  }
  for (const origin of origins) {
    const url = new URL(origin);
    if (
      (url.protocol !== "https:" && url.protocol !== "http:") ||
      url.username !== "" ||
      url.password !== "" ||
      url.pathname !== "/" ||
      url.search !== "" ||
      url.hash !== ""
    ) {
      throw new Error(`invalid CORS origin: ${origin}`);
    }
    if (runtime === "production" && url.protocol !== "https:") {
      throw new Error("production CORS origins must use HTTPS");
    }
  }
}

function rejectProductionLoopback(name: string, rawUrl: string): void {
  const url = new URL(rawUrl);
  if (LOOPBACK_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error(`production ${name} must not use a loopback host`);
  }
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env) {
  const runtime = RuntimeEnvironment.parse(environment.NODE_ENV ?? "development");
  const databaseUrl = required(environment, "DATABASE_URL");
  const redisUrl = required(environment, "REDIS_URL");
  const corsOrigins = commaList(required(environment, "CORS_ORIGINS"));
  const trustedProxyCidrs = commaList(environment.TRUSTED_PROXY_CIDRS);
  const phoneCodePepper = required(environment, "PHONE_CODE_PEPPER");
  if (phoneCodePepper.length < 16)
    throw new Error("PHONE_CODE_PEPPER must be at least 16 characters");
  validateCorsOrigins(corsOrigins, runtime);
  validateTrustedProxyCidrs(trustedProxyCidrs);

  if (runtime === "production") {
    rejectProductionLoopback("DATABASE_URL", databaseUrl);
    rejectProductionLoopback("REDIS_URL", redisUrl);
    if (/change[-_ ]?me|test[-_ ]?only|placeholder/i.test(phoneCodePepper)) {
      throw new Error("PHONE_CODE_PEPPER must not use a production placeholder");
    }
  }

  const provider = PhoneProvider.parse(environment.PHONE_PROVIDER ?? "disabled");
  const phone =
    provider === "disabled"
      ? ({ provider } as const)
      : ({
          provider,
          accessKeyId: required(environment, "ALIYUN_SMS_ACCESS_KEY_ID"),
          accessKeySecret: required(environment, "ALIYUN_SMS_ACCESS_KEY_SECRET"),
          signName: required(environment, "ALIYUN_SMS_SIGN_NAME"),
          templateCode: required(environment, "ALIYUN_SMS_TEMPLATE_CODE"),
        } as const);

  const port = z.coerce
    .number()
    .int()
    .min(1)
    .max(65_535)
    .parse(environment.PORT ?? 4110);
  return {
    runtime,
    host: environment.HOST?.trim() || "127.0.0.1",
    port,
    databaseUrl,
    redisUrl,
    corsOrigins,
    trustedProxyCidrs,
    phoneCodePepper,
    phone,
    jwt: {
      issuer: environment.JWT_ISSUER?.trim() || "https://api-org.tashan.chat",
      audience: environment.JWT_AUDIENCE?.trim() || "tashan-orgspace",
      activeKeyId: required(environment, "JWT_ACTIVE_KEY_ID"),
      privateKeyPem: required(environment, "JWT_PRIVATE_KEY"),
      publicKeyPem: required(environment, "JWT_PUBLIC_KEY"),
    },
  };
}

export type ApiConfig = ReturnType<typeof loadConfig>;
