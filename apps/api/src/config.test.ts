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
  SERVICE_VERSION: "0.0.0-development",
  PHONE_CODE_PEPPER: "test-only-phone-code-pepper",
  PHONE_PROVIDER: "disabled",
  S3_ENDPOINT: "http://minio:9000",
  S3_PUBLIC_ORIGIN: "http://127.0.0.1:59000",
  S3_REGION: "us-east-1",
  S3_BUCKET: "orgspace-files",
  S3_ACCESS_KEY_ID: "test-access",
  S3_SECRET_ACCESS_KEY: "test-secret",
  S3_FORCE_PATH_STYLE: "true",
  FILE_STORAGE_ENABLED: "true",
} as const;

function productionEnvironment(overrides: Record<string, string> = {}) {
  return {
    ...validEnvironment,
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://orgspace@postgres:5432/orgspace",
    REDIS_URL: "redis://redis:6379",
    CORS_ORIGINS: "https://orgspace.tashan.chat",
    PHONE_CODE_PEPPER: "production-phone-code-pepper-value",
    SERVICE_VERSION: "0.1.0-alpha.2",
    S3_PUBLIC_ORIGIN: "https://files.orgspace.tashan.chat",
    ...overrides,
  };
}

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

  test("loads S3 configuration and rejects unsafe production public origins", () => {
    expect(loadConfig(validEnvironment).objectStore).toMatchObject({
      endpoint: "http://minio:9000",
      publicOrigin: "http://127.0.0.1:59000",
      bucket: "orgspace-files",
      forcePathStyle: true,
    });
    expect(() =>
      loadConfig(productionEnvironment({ S3_PUBLIC_ORIGIN: "http://files.orgspace.tashan.chat" })),
    ).toThrow("production S3 public origin must use HTTPS");
  });

  test("requires a release service version in production", () => {
    expect(() => loadConfig(productionEnvironment({ SERVICE_VERSION: "" }))).toThrow(
      "SERVICE_VERSION is required",
    );
    expect(() => loadConfig(productionEnvironment({ SERVICE_VERSION: "dev" }))).toThrow(
      "production SERVICE_VERSION must be a release version",
    );
    expect(loadConfig(productionEnvironment()).serviceVersion).toBe("0.1.0-alpha.2");
  });

  test("loads a complete independent Aliyun verification configuration", () => {
    expect(
      loadConfig({
        ...validEnvironment,
        PHONE_PROVIDER: "aliyun",
        ALIYUN_SMS_ACCESS_KEY_ID: "access-key-id",
        ALIYUN_SMS_ACCESS_KEY_SECRET: "access-key-secret",
        ALIYUN_SMS_SIGN_NAME: "他山组织空间",
        ALIYUN_SMS_TEMPLATE_CODE: "SMS_TEST",
        ALIYUN_SMS_TEMPLATE_PARAM_KEY: "code",
        ALIYUN_SMS_ENDPOINT: "dysmsapi.aliyuncs.com",
        ALIYUN_SMS_REGION_ID: "cn-hangzhou",
      }).phone,
    ).toEqual({
      provider: "aliyun",
      accessKeyId: "access-key-id",
      accessKeySecret: "access-key-secret",
      signName: "他山组织空间",
      templateCode: "SMS_TEST",
      templateParamKey: "code",
      endpoint: "dysmsapi.aliyuncs.com",
      regionId: "cn-hangzhou",
    });
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
