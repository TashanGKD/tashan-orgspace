import * as Dysmsapi from "@alicloud/dysmsapi20170525";
import * as OpenApi from "@alicloud/openapi-client";

import type { VerificationCodeSender } from "./verification-code-sender.js";

export interface AliyunVerificationCodeSenderOptions {
  accessKeyId: string;
  accessKeySecret: string;
  signName: string;
  templateCode: string;
  templateParamKey: string;
  endpoint: string;
  regionId: string;
}

interface AliyunSmsResponse {
  body?: {
    code?: string;
    requestId?: string;
  };
}

export interface AliyunSmsClient {
  sendSms(request: InstanceType<typeof Dysmsapi.SendSmsRequest>): Promise<AliyunSmsResponse>;
}

type AliyunSmsClientConstructor = new (
  config: InstanceType<typeof OpenApi.Config>,
) => AliyunSmsClient;

function assertComplete(options: AliyunVerificationCodeSenderOptions): void {
  if (Object.values(options).some((value) => value.trim() === "")) {
    throw new Error("Aliyun SMS configuration is incomplete");
  }
}

function resolveClientConstructor(): AliyunSmsClientConstructor {
  const moduleValue = Dysmsapi as unknown as { default?: unknown };
  if (typeof moduleValue.default === "function") {
    return moduleValue.default as AliyunSmsClientConstructor;
  }
  const nestedDefault = (moduleValue.default as { default?: unknown } | undefined)?.default;
  if (typeof nestedDefault === "function") {
    return nestedDefault as AliyunSmsClientConstructor;
  }
  throw new Error("Aliyun SMS client is unavailable");
}

function createClient(options: AliyunVerificationCodeSenderOptions): AliyunSmsClient {
  const Client = resolveClientConstructor();
  return new Client(
    new OpenApi.Config({
      accessKeyId: options.accessKeyId,
      accessKeySecret: options.accessKeySecret,
      endpoint: options.endpoint,
      regionId: options.regionId,
    }),
  );
}

function providerPhone(phone: string): string {
  return phone.startsWith("+86") ? phone.slice(3) : phone;
}

export class AliyunVerificationCodeSender implements VerificationCodeSender {
  public readonly available = true;
  private readonly client: AliyunSmsClient;

  public constructor(
    private readonly options: AliyunVerificationCodeSenderOptions,
    injectedClient?: AliyunSmsClient,
  ) {
    assertComplete(options);
    this.client = injectedClient ?? createClient(options);
  }

  public async send(input: {
    phone: string;
    code: string;
    expiresAt: Date;
    purpose: "register" | "password_reset";
  }): Promise<void> {
    const response = await this.client.sendSms(
      new Dysmsapi.SendSmsRequest({
        phoneNumbers: providerPhone(input.phone),
        signName: this.options.signName,
        templateCode: this.options.templateCode,
        templateParam: JSON.stringify({ [this.options.templateParamKey]: input.code }),
      }),
    );
    if (response.body === undefined) {
      throw new Error("Aliyun SMS response is incomplete");
    }
    if (response.body.code !== "OK") {
      throw new Error("Aliyun SMS delivery was not accepted");
    }
    if (response.body.requestId?.trim() === "") {
      throw new Error("Aliyun SMS response is incomplete");
    }
    if (response.body.requestId === undefined) {
      throw new Error("Aliyun SMS response is incomplete");
    }
  }
}
