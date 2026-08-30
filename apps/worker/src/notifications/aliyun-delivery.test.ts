import { describe, expect, test, vi } from "vitest";
import { AliyunSmsDelivery, SmsProviderTimeoutError, type SmsProvider } from "./aliyun-delivery.js";
import { AliyunSmsProvider } from "./aliyun-sms-provider.js";

function fixture(
  provider: SmsProvider,
  status: "pending" | "accepted" | "unknown" = "pending",
  bizId: string | null = null,
) {
  const updates: unknown[] = [];
  const store = {
    readAttempt: vi.fn().mockResolvedValue({
      id: "attempt-1",
      status,
      bizId,
      requestId: null,
      phone: "+8613812345678",
      idempotencyKey: "sms:key",
      templateCode: "SMS_NOTICE",
      templateParams: { name: "张三" },
    }),
    updateAttempt: vi.fn(async (value) => {
      updates.push(value);
    }),
  };
  return { delivery: new AliyunSmsDelivery({ provider, store }), store, updates };
}
describe("Alibaba SMS delivery", () => {
  test("keeps provider acceptance distinct from carrier delivery", async () => {
    const provider: SmsProvider = {
      lookup: vi.fn().mockResolvedValue({ status: "not_found" }),
      send: vi.fn().mockResolvedValue({ requestId: "req-1", bizId: "biz-1" }),
    };
    const f = fixture(provider);
    await f.delivery.process("attempt-1");
    expect(f.updates.at(-1)).toMatchObject({
      status: "accepted",
      requestId: "req-1",
      bizId: "biz-1",
    });
    expect(f.updates.at(-1)).not.toMatchObject({ status: "delivered" });
  });
  test("queries an accepted BizId and records final carrier delivery", async () => {
    const provider: SmsProvider = {
      lookup: vi.fn().mockResolvedValue({ status: "delivered" }),
      send: vi.fn(),
    };
    const f = fixture(provider, "accepted", "biz-1");
    await f.delivery.process("attempt-1");
    expect(provider.lookup).toHaveBeenCalledWith(expect.objectContaining({ bizId: "biz-1" }));
    expect(provider.send).not.toHaveBeenCalled();
    expect(f.updates.at(-1)).toMatchObject({ status: "delivered" });
  });
  test("does not send a duplicate when the idempotency lookup finds a pending message", async () => {
    const provider: SmsProvider = {
      lookup: vi.fn().mockResolvedValue({ status: "pending", bizId: "existing-biz" }),
      send: vi.fn(),
    };
    const f = fixture(provider);
    await f.delivery.process("attempt-1");
    expect(provider.send).not.toHaveBeenCalled();
    expect(f.updates.at(-1)).toMatchObject({ status: "accepted", bizId: "existing-biz" });
  });
  test("queries after timeout before any retry", async () => {
    const lookup = vi.fn().mockResolvedValueOnce({ status: "not_found" }).mockResolvedValueOnce({
      status: "delivered",
      bizId: "biz-timeout",
      requestId: "req-timeout",
    });
    const send = vi.fn().mockRejectedValue(new SmsProviderTimeoutError());
    const provider = { lookup, send };
    const f = fixture(provider);
    await f.delivery.process("attempt-1");
    expect(f.updates.at(-1)).toMatchObject({ status: "unknown" });
    f.store.readAttempt.mockResolvedValue({ ...(await f.store.readAttempt()), status: "unknown" });
    await f.delivery.process("attempt-1");
    expect(lookup).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenCalledTimes(1);
    expect(f.updates.at(-1)).toMatchObject({ status: "delivered", bizId: "biz-timeout" });
  });
  test("does not persist or expose phone numbers in update payloads", async () => {
    const provider: SmsProvider = {
      lookup: vi.fn().mockResolvedValue({ status: "not_found" }),
      send: vi.fn().mockResolvedValue({ requestId: "req", bizId: "biz" }),
    };
    const f = fixture(provider);
    await f.delivery.process("attempt-1");
    expect(JSON.stringify(f.updates)).not.toContain("13812345678");
  });
  test("maps an SDK timeout to an unknown delivery outcome", async () => {
    const client = {
      querySendDetails: vi.fn().mockResolvedValue({ body: {} }),
      sendSms: vi
        .fn()
        .mockRejectedValue(Object.assign(new Error("socket timed out"), { code: "ETIMEDOUT" })),
    };
    const provider = new AliyunSmsProvider(
      {
        accessKeyId: "key",
        accessKeySecret: "secret",
        signName: "sign",
        endpoint: "dysmsapi.aliyuncs.com",
        regionId: "cn-hangzhou",
      },
      client,
    );
    await expect(
      provider.send({
        phone: "+8613812345678",
        idempotencyKey: "sms:key",
        templateCode: "SMS_NOTICE",
        templateParams: { content: "notice" },
      }),
    ).rejects.toBeInstanceOf(SmsProviderTimeoutError);
  });

  test("omits TemplateParam for an approved fixed-content template", async () => {
    const client = {
      querySendDetails: vi.fn().mockResolvedValue({ body: {} }),
      sendSms: vi.fn().mockResolvedValue({
        body: { code: "OK", requestId: "req-fixed", bizId: "biz-fixed" },
      }),
    };
    const provider = new AliyunSmsProvider(
      {
        accessKeyId: "key",
        accessKeySecret: "secret",
        signName: "他山青年",
        endpoint: "dysmsapi.aliyuncs.com",
        regionId: "cn-hangzhou",
      },
      client,
    );
    await provider.send({
      phone: "+8613812345678",
      idempotencyKey: "sms:fixed",
      templateCode: "SMS_FIXED_NOTICE",
      templateParams: {},
    });
    expect(client.sendSms.mock.calls[0]?.[0]).not.toHaveProperty("templateParam");
  });

  test("queries the Beijing send date and matches the provider OutId", async () => {
    const client = {
      sendSms: vi.fn(),
      querySendDetails: vi.fn().mockResolvedValue({
        body: {
          requestId: "query-request",
          smsSendDetailDTOs: {
            smsSendDetailDTO: [{ outId: "sms:midnight", sendStatus: 3 }],
          },
        },
      }),
    };
    const provider = new AliyunSmsProvider(
      {
        accessKeyId: "key",
        accessKeySecret: "secret",
        signName: "他山青年",
        endpoint: "dysmsapi.aliyuncs.com",
        regionId: "cn-hangzhou",
        clock: () => new Date("2026-08-30T16:16:44.000Z"),
      },
      client,
    );
    await expect(
      provider.lookup({
        phone: "+8618911597794",
        idempotencyKey: "sms:midnight",
        bizId: "866920288106604764^0",
      }),
    ).resolves.toMatchObject({ status: "delivered", bizId: "866920288106604764^0" });
    expect(client.querySendDetails.mock.calls[0]?.[0]).toMatchObject({
      bizId: "866920288106604764^0",
      sendDate: "20260831",
    });
  });

  test("falls back to OutId lookup when BizId filtering returns no DTO", async () => {
    const client = {
      sendSms: vi.fn(),
      querySendDetails: vi
        .fn()
        .mockResolvedValueOnce({ body: { smsSendDetailDTOs: { smsSendDetailDTO: [] } } })
        .mockResolvedValueOnce({
          body: {
            smsSendDetailDTOs: {
              smsSendDetailDTO: [{ outId: "sms:fallback", sendStatus: 2 }],
            },
          },
        }),
    };
    const provider = new AliyunSmsProvider(
      {
        accessKeyId: "key",
        accessKeySecret: "secret",
        signName: "他山青年",
        endpoint: "dysmsapi.aliyuncs.com",
        regionId: "cn-hangzhou",
        clock: () => new Date("2026-08-30T16:16:44.000Z"),
      },
      client,
    );
    await expect(
      provider.lookup({
        phone: "+8618911597794",
        idempotencyKey: "sms:fallback",
        bizId: "biz-without-dto",
      }),
    ).resolves.toMatchObject({ status: "failed", bizId: "biz-without-dto" });
    expect(client.querySendDetails).toHaveBeenCalledTimes(2);
    expect(client.querySendDetails.mock.calls[1]?.[0]).not.toHaveProperty("bizId");
  });
});
