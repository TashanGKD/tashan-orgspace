import { describe, expect, test } from "vitest";

import { loadWorkerConfig } from "./config.js";

const valid = {
  NODE_ENV: "development",
  DATABASE_URL: "postgresql://orgspace@127.0.0.1:55432/orgspace",
  S3_ENDPOINT: "http://minio:9000",
  S3_PUBLIC_ORIGIN: "http://127.0.0.1:59000",
  S3_REGION: "us-east-1",
  S3_BUCKET: "orgspace-files",
  S3_ACCESS_KEY_ID: "test-access",
  S3_SECRET_ACCESS_KEY: "test-secret",
  S3_FORCE_PATH_STYLE: "true",
  FILE_STORAGE_ENABLED: "true",
};

describe("worker configuration", () => {
  test("requires explicit S3 credentials and parses safe local endpoints", () => {
    expect(() => loadWorkerConfig({ ...valid, S3_SECRET_ACCESS_KEY: "" })).toThrow(
      "S3_SECRET_ACCESS_KEY",
    );
    expect(loadWorkerConfig(valid).objectStore).toMatchObject({
      endpoint: "http://minio:9000",
      publicOrigin: "http://127.0.0.1:59000",
      bucket: "orgspace-files",
    });
  });
  test("requires a separate notification template when SMS delivery is enabled", () => {
    expect(() => loadWorkerConfig({ ...valid, SMS_DELIVERY_ENABLED: "true" })).toThrow(
      "ALIYUN_SMS_ACCESS_KEY_ID",
    );
    expect(
      loadWorkerConfig({
        ...valid,
        SMS_DELIVERY_ENABLED: "true",
        ALIYUN_SMS_ACCESS_KEY_ID: "key",
        ALIYUN_SMS_ACCESS_KEY_SECRET: "secret",
        ALIYUN_SMS_SIGN_NAME: "他山组织空间",
        ALIYUN_SMS_NOTIFICATION_TEMPLATE_CODE: "SMS_NOTICE",
        ALIYUN_SMS_NOTIFICATION_TEMPLATE_PARAM_KEY: "content",
        ALIYUN_SMS_ENDPOINT: "dysmsapi.aliyuncs.com",
        ALIYUN_SMS_REGION_ID: "cn-hangzhou",
      }).sms,
    ).toMatchObject({ templateCode: "SMS_NOTICE", templateParamKey: "content" });
  });
});
