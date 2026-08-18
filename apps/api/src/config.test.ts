import { describe, expect, test } from "vitest";

import { loadConfig } from "./config.js";

const validEnvironment = {
  NODE_ENV: "development",
  DATABASE_URL: "postgresql://orgspace:local@127.0.0.1:55432/orgspace",
  REDIS_URL: "redis://127.0.0.1:56379",
  CORS_ORIGINS: "http://127.0.0.1:4173",
  JWT_PRIVATE_KEY: "test-private-key-material",
  JWT_PUBLIC_KEY: "test-public-key-material",
  JWT_ACTIVE_KEY_ID: "test-key-1",
  PHONE_CODE_PEPPER: "test-only-phone-code-pepper",
  PHONE_PROVIDER: "disabled",
} as const;

describe("API configuration safety", () => {
  test("rejects missing signing material and wildcard CORS", () => {
    expect(() => loadConfig({ ...validEnvironment, JWT_PRIVATE_KEY: "" })).toThrow(
      "JWT_PRIVATE_KEY",
    );
    expect(() => loadConfig({ ...validEnvironment, CORS_ORIGINS: "*" })).toThrow(
      "explicit origins",
    );
  });

  test("rejects production loopback data services and placeholder secrets", () => {
    expect(() =>
      loadConfig({
        ...validEnvironment,
        NODE_ENV: "production",
        CORS_ORIGINS: "https://org.tashan.chat",
      }),
    ).toThrow("production DATABASE_URL");

    expect(() =>
      loadConfig({
        ...validEnvironment,
        NODE_ENV: "production",
        DATABASE_URL: "postgresql://orgspace@db.internal/orgspace",
        REDIS_URL: "redis://redis.internal:6379",
        CORS_ORIGINS: "https://org.tashan.chat",
        PHONE_CODE_PEPPER: "change-me-in-production",
      }),
    ).toThrow("PHONE_CODE_PEPPER");
  });

  test("rejects an enabled Aliyun provider without every credential", () => {
    expect(() => loadConfig({ ...validEnvironment, PHONE_PROVIDER: "aliyun" })).toThrow(
      "ALIYUN_SMS_ACCESS_KEY_ID",
    );
  });

  test("defaults the listener to loopback and parses explicit lists", () => {
    expect(
      loadConfig({
        ...validEnvironment,
        CORS_ORIGINS: "http://127.0.0.1:4173,https://org.tashan.chat",
        TRUSTED_PROXY_CIDRS: "10.0.0.0/8,2001:db8::/32",
      }),
    ).toMatchObject({
      host: "127.0.0.1",
      port: 4110,
      corsOrigins: ["http://127.0.0.1:4173", "https://org.tashan.chat"],
      trustedProxyCidrs: ["10.0.0.0/8", "2001:db8::/32"],
      phone: { provider: "disabled" },
    });
  });
});
