import * as Dysmsapi from "@alicloud/dysmsapi20170525";
import * as OpenApi from "@alicloud/openapi-client";
import { SmsProviderTimeoutError, type SmsProvider } from "./aliyun-delivery.js";

interface Client {
  sendSms(
    request: InstanceType<typeof Dysmsapi.SendSmsRequest>,
  ): Promise<{ body?: { code?: string; requestId?: string; bizId?: string } }>;
  querySendDetails(request: InstanceType<typeof Dysmsapi.QuerySendDetailsRequest>): Promise<{
    body?: {
      requestId?: string;
      smsSendDetailDTOs?: {
        smsSendDetailDTO?: Array<{ outId?: string; sendStatus?: number }>;
      };
    };
  }>;
}
type ClientConstructor = new (config: InstanceType<typeof OpenApi.Config>) => Client;
function constructor(): ClientConstructor {
  const module = Dysmsapi as unknown as { default?: unknown };
  if (typeof module.default === "function") return module.default as ClientConstructor;
  const nested = (module.default as { default?: unknown } | undefined)?.default;
  if (typeof nested === "function") return nested as ClientConstructor;
  throw new Error("Aliyun SMS client unavailable");
}
function phone(raw: string) {
  return raw.startsWith("+86") ? raw.slice(3) : raw;
}
function isTimeout(error: unknown) {
  if (!(error instanceof Error)) return false;
  const code = (error as Error & { code?: unknown }).code;
  return (
    code === "ETIMEDOUT" ||
    code === "ESOCKETTIMEDOUT" ||
    error.name === "RequestTimeout" ||
    /timed?\s*out/i.test(error.message)
  );
}
export class AliyunSmsProvider implements SmsProvider {
  private readonly client: Client;
  public constructor(
    private readonly options: {
      accessKeyId: string;
      accessKeySecret: string;
      signName: string;
      endpoint: string;
      regionId: string;
      clock?: () => Date;
    },
    client?: Client,
  ) {
    this.client =
      client ??
      new (constructor())(
        new OpenApi.Config({
          accessKeyId: options.accessKeyId,
          accessKeySecret: options.accessKeySecret,
          endpoint: options.endpoint,
          regionId: options.regionId,
        }),
      );
  }
  public async send(input: {
    phone: string;
    idempotencyKey: string;
    templateCode: string;
    templateParams: Record<string, string>;
  }) {
    let response;
    try {
      response = await this.client.sendSms(
        new Dysmsapi.SendSmsRequest({
          phoneNumbers: phone(input.phone),
          signName: this.options.signName,
          templateCode: input.templateCode,
          ...(Object.keys(input.templateParams).length > 0
            ? { templateParam: JSON.stringify(input.templateParams) }
            : {}),
          outId: input.idempotencyKey,
        }),
      );
    } catch (error) {
      if (isTimeout(error)) throw new SmsProviderTimeoutError();
      throw error;
    }
    if (response.body?.code !== "OK" || !response.body.requestId || !response.body.bizId)
      throw new Error("Aliyun SMS send was not accepted");
    return { requestId: response.body.requestId, bizId: response.body.bizId };
  }
  public async lookup(input: { phone: string; idempotencyKey: string; bizId: string | null }) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(this.options.clock?.() ?? new Date());
    const part = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((value) => value.type === type)?.value ?? "";
    const sendDate = `${part("year")}${part("month")}${part("day")}`;
    const query = (bizId?: string) =>
      this.client.querySendDetails(
        new Dysmsapi.QuerySendDetailsRequest({
          phoneNumber: phone(input.phone),
          sendDate,
          pageSize: 50,
          currentPage: 1,
          ...(bizId ? { bizId } : {}),
        }),
      );
    let response = await query(input.bizId ?? undefined);
    let detail = response.body?.smsSendDetailDTOs?.smsSendDetailDTO?.find(
      (item) => item.outId === input.idempotencyKey,
    );
    if (!detail && input.bizId !== null) {
      response = await query();
      detail = response.body?.smsSendDetailDTOs?.smsSendDetailDTO?.find(
        (item) => item.outId === input.idempotencyKey,
      );
    }
    if (!detail) return { status: "not_found" as const };
    const status: "delivered" | "failed" | "pending" =
      detail.sendStatus === 3 ? "delivered" : detail.sendStatus === 2 ? "failed" : "pending";
    return {
      status,
      ...(response.body?.requestId ? { requestId: response.body.requestId } : {}),
      ...(input.bizId ? { bizId: input.bizId } : {}),
    };
  }
}
