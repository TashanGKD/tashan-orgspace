import { randomUUID } from "node:crypto";

import { z, type ZodType } from "zod";

import { Capability, type CapabilityId } from "@tashan/capabilities";
import {
  AuditListQuery,
  AuditListResponse,
  CapabilityIdPath,
  DeviceIdPath,
  DeviceListResponse,
  DeviceRevokeResponse,
  ErrorEnvelope,
  HealthResponse,
  LoginRequest,
  LoginResponse,
  LogoutRequest,
  LogoutResponse,
  OrganizationCreateRequest,
  OrganizationCreateResponse,
  OrganizationIdPath,
  OrganizationListResponse,
  OrganizationMemberAddRequest,
  OrganizationMemberAddResponse,
  OrganizationMemberListResponse,
  PhoneVerificationConfirmRequest,
  PhoneVerificationConfirmResponse,
  PhoneVerificationStartRequest,
  PhoneVerificationStartResponse,
  RefreshRequest,
  RefreshResponse,
  RegisterRequest,
  RegisterResponse,
  WhoAmIResponse,
  type ErrorCode,
} from "@tashan/contracts";

import type { HttpMethod, Transport } from "./transport.js";

const CapabilityListResponse = z.object({ items: z.array(Capability) }).strict();

type MaybePromise<T> = T | Promise<T>;

export interface SdkCredentialStore {
  getAccessToken(): MaybePromise<string | undefined>;
  getRefreshToken(): MaybePromise<string | undefined>;
  updateTokens(tokens: { accessToken: string; refreshToken: string }): MaybePromise<void>;
  clearTokens(): MaybePromise<void>;
}

export interface OrgSpaceClientOptions {
  transport: Transport;
  credentials: SdkCredentialStore;
  deviceId: string;
  clientChannel: "web" | "cli";
  invocationSource: "web" | "cli" | "ai_via_cli";
}

export class OrgSpaceApiError extends Error {
  public constructor(
    public readonly code: ErrorCode,
    public readonly status: number,
    message: string,
    public readonly requestId: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "OrgSpaceApiError";
  }
}

export class OrgSpaceProtocolError extends Error {
  public constructor(
    message: string,
    public override readonly cause?: unknown,
  ) {
    super(message);
    this.name = "OrgSpaceProtocolError";
  }
}

interface RequestOptions {
  authenticated?: boolean;
  idempotencyKey?: string;
  signal?: AbortSignal | undefined;
  allowRefresh?: boolean;
}

export function createOrgSpaceClient(options: OrgSpaceClientOptions) {
  async function decode<T>(schema: ZodType<T>, body: unknown): Promise<T> {
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw new OrgSpaceProtocolError("response schema validation failed", parsed.error);
    }
    return parsed.data;
  }

  async function request<T>(
    method: HttpMethod,
    path: string,
    responseSchema: ZodType<T>,
    body: unknown,
    requestOptions: RequestOptions = {},
  ): Promise<T> {
    const headers: Record<string, string> = {
      accept: "application/json",
      "x-torg-request-id": randomUUID(),
      "x-torg-device-id": options.deviceId,
      "x-torg-client-channel": options.clientChannel,
      "x-torg-invocation-source": options.invocationSource,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(requestOptions.idempotencyKey === undefined
        ? {}
        : { "idempotency-key": requestOptions.idempotencyKey }),
    };
    if (requestOptions.authenticated === true) {
      const accessToken = await options.credentials.getAccessToken();
      if (accessToken === undefined) {
        throw new OrgSpaceApiError(
          "AUTH_REQUIRED",
          401,
          "authentication is required",
          randomUUID(),
        );
      }
      headers.authorization = `Bearer ${accessToken}`;
    }

    const response = await options.transport({
      method,
      path,
      headers,
      ...(body === undefined ? {} : { body }),
      ...(requestOptions.signal === undefined ? {} : { signal: requestOptions.signal }),
    });
    if (response.status >= 200 && response.status < 300) {
      return decode(responseSchema, response.body);
    }

    const parsedError = ErrorEnvelope.safeParse(response.body);
    if (!parsedError.success) {
      throw new OrgSpaceProtocolError("error response schema validation failed", parsedError.error);
    }
    const apiError = new OrgSpaceApiError(
      parsedError.data.error.code,
      response.status,
      parsedError.data.error.message,
      parsedError.data.error.requestId,
      parsedError.data.error.details,
    );
    if (
      apiError.code === "AUTH_TOKEN_EXPIRED" &&
      requestOptions.authenticated === true &&
      requestOptions.allowRefresh !== false
    ) {
      await refreshStoredTokens(requestOptions.signal);
      return request(method, path, responseSchema, body, {
        ...requestOptions,
        allowRefresh: false,
      });
    }
    throw apiError;
  }

  async function refreshStoredTokens(signal?: AbortSignal) {
    const refreshToken = await options.credentials.getRefreshToken();
    if (refreshToken === undefined) {
      throw new OrgSpaceApiError(
        "AUTH_REQUIRED",
        401,
        "refresh token is unavailable",
        randomUUID(),
      );
    }
    const body = RefreshRequest.parse({ refreshToken });
    const refreshed = await request("POST", "/v1/auth/refresh", RefreshResponse, body, {
      signal,
      allowRefresh: false,
    });
    await options.credentials.updateTokens(refreshed.tokens);
    return refreshed;
  }

  return {
    health: (signal?: AbortSignal) =>
      request("GET", "/v1/health", HealthResponse, undefined, { signal }),

    listCapabilities: (signal?: AbortSignal) =>
      request("GET", "/v1/capabilities", CapabilityListResponse, undefined, { signal }),

    describeCapability: (capabilityId: CapabilityId, signal?: AbortSignal) => {
      const path = CapabilityIdPath.parse({ capabilityId });
      return request(
        "GET",
        `/v1/capabilities/${encodeURIComponent(path.capabilityId)}`,
        Capability,
        undefined,
        { signal },
      );
    },

    register: (input: unknown, mutation: { idempotencyKey: string; signal?: AbortSignal }) => {
      const body = RegisterRequest.parse(input);
      return request("POST", "/v1/auth/register", RegisterResponse, body, mutation);
    },

    startPhoneVerification: (
      input: unknown,
      mutation: { idempotencyKey: string; signal?: AbortSignal },
    ) => {
      const body = PhoneVerificationStartRequest.parse(input);
      return request("POST", "/v1/phone-verifications", PhoneVerificationStartResponse, body, {
        ...mutation,
        authenticated: true,
      });
    },

    confirmPhoneVerification: (
      input: unknown,
      mutation: { idempotencyKey: string; signal?: AbortSignal },
    ) => {
      const body = PhoneVerificationConfirmRequest.parse(input);
      return request(
        "POST",
        "/v1/phone-verifications/confirm",
        PhoneVerificationConfirmResponse,
        body,
        { ...mutation, authenticated: true },
      );
    },

    login: async (input: unknown, signal?: AbortSignal) => {
      const body = LoginRequest.parse(input);
      const loggedIn = await request("POST", "/v1/auth/login", LoginResponse, body, { signal });
      await options.credentials.updateTokens(loggedIn.tokens);
      return loggedIn;
    },

    refresh: async (input?: unknown, signal?: AbortSignal) => {
      if (input === undefined) return refreshStoredTokens(signal);
      const body = RefreshRequest.parse(input);
      const refreshed = await request("POST", "/v1/auth/refresh", RefreshResponse, body, {
        signal,
        allowRefresh: false,
      });
      await options.credentials.updateTokens(refreshed.tokens);
      return refreshed;
    },

    logout: async (input: unknown = {}, signal?: AbortSignal) => {
      const body = LogoutRequest.parse(input);
      const loggedOut = await request("POST", "/v1/auth/logout", LogoutResponse, body, {
        authenticated: true,
        signal,
      });
      await options.credentials.clearTokens();
      return loggedOut;
    },

    whoami: (signal?: AbortSignal) =>
      request("GET", "/v1/auth/whoami", WhoAmIResponse, undefined, {
        authenticated: true,
        signal,
      }),

    listDevices: (signal?: AbortSignal) =>
      request("GET", "/v1/devices", DeviceListResponse, undefined, {
        authenticated: true,
        signal,
      }),

    revokeDevice: (
      deviceId: string,
      mutation: { idempotencyKey: string; signal?: AbortSignal },
    ) => {
      const path = DeviceIdPath.parse({ deviceId });
      return request(
        "DELETE",
        `/v1/devices/${encodeURIComponent(path.deviceId)}`,
        DeviceRevokeResponse,
        undefined,
        { ...mutation, authenticated: true },
      );
    },

    listOrganizations: (signal?: AbortSignal) =>
      request("GET", "/v1/organizations", OrganizationListResponse, undefined, {
        authenticated: true,
        signal,
      }),

    createOrganization: (
      input: unknown,
      mutation: { idempotencyKey: string; signal?: AbortSignal },
    ) => {
      const body = OrganizationCreateRequest.parse(input);
      return request("POST", "/v1/organizations", OrganizationCreateResponse, body, {
        ...mutation,
        authenticated: true,
      });
    },

    listMembers: (organizationId: string, signal?: AbortSignal) => {
      const path = OrganizationIdPath.parse({ organizationId });
      return request(
        "GET",
        `/v1/organizations/${encodeURIComponent(path.organizationId)}/members`,
        OrganizationMemberListResponse,
        undefined,
        { authenticated: true, signal },
      );
    },

    addMember: (
      organizationId: string,
      input: unknown,
      mutation: { idempotencyKey: string; signal?: AbortSignal },
    ) => {
      const path = OrganizationIdPath.parse({ organizationId });
      const body = OrganizationMemberAddRequest.parse(input);
      return request(
        "POST",
        `/v1/organizations/${encodeURIComponent(path.organizationId)}/members`,
        OrganizationMemberAddResponse,
        body,
        { ...mutation, authenticated: true },
      );
    },

    listAuditEvents: (input: unknown, signal?: AbortSignal) => {
      const query = AuditListQuery.parse(input);
      const search = new URLSearchParams();
      if (query.organizationId !== undefined) search.set("organizationId", query.organizationId);
      if (query.cursor !== undefined) search.set("cursor", query.cursor);
      search.set("limit", String(query.limit));
      return request("GET", `/v1/audit-events?${search}`, AuditListResponse, undefined, {
        authenticated: true,
        signal,
      });
    },
  };
}

export type OrgSpaceClient = ReturnType<typeof createOrgSpaceClient>;
