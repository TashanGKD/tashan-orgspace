import { describe, expect, test, vi } from "vitest";

import {
  AliyunVerificationCodeSender,
  type AliyunSmsClient,
  type AliyunVerificationCodeSenderOptions,
} from "../../src/phone/aliyun-verification-code-sender.js";

const options: AliyunVerificationCodeSenderOptions = {
  accessKeyId: "test-access-key-id",
  accessKeySecret: "test-access-key-secret",
  signName: "他山组织空间",
  templateCode: "SMS_TEST",
  templateParamKey: "code",
  endpoint: "dysmsapi.aliyuncs.com",
  regionId: "cn-hangzhou",
};

const message = {
  phone: "+8613800138000",
  code: "246810",
  expiresAt: new Date("2026-08-19T00:00:00.000Z"),
  purpose: "register" as const,
};

describe("OrgSpace Aliyun verification sender", () => {
  test("sends the configured template and accepts an explicit provider success", async () => {
    const sendSms = vi.fn().mockResolvedValue({ body: { code: "OK", requestId: "request-1" } });
    const sender = new AliyunVerificationCodeSender(options, { sendSms } as AliyunSmsClient);

    await expect(sender.send(message)).resolves.toBeUndefined();
    expect(sendSms).toHaveBeenCalledTimes(1);
    expect(sendSms.mock.calls[0]?.[0]).toMatchObject({
      phoneNumbers: "13800138000",
      signName: "他山组织空间",
      templateCode: "SMS_TEST",
      templateParam: JSON.stringify({ code: "246810" }),
    });
  });

  test.each([
    [{ body: { code: "isv.BUSINESS_LIMIT_CONTROL", requestId: "request-2" } }, "not accepted"],
    [{ body: { code: "OK" } }, "incomplete"],
    [{}, "incomplete"],
  ])("fails closed for response %#", async (response, error) => {
    const sender = new AliyunVerificationCodeSender(options, {
      sendSms: vi.fn().mockResolvedValue(response),
    } as AliyunSmsClient);

    await expect(sender.send(message)).rejects.toThrow(error);
  });

  test.each([
    "accessKeyId",
    "accessKeySecret",
    "signName",
    "templateCode",
    "templateParamKey",
    "endpoint",
    "regionId",
  ] as const)("rejects empty %s before creating a client", (key) => {
    expect(() => new AliyunVerificationCodeSender({ ...options, [key]: "" })).toThrow(
      "configuration is incomplete",
    );
  });
});
