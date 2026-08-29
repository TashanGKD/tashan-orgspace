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
  FileDeleteResponse,
  FileDownloadResponse,
  FileListQuery,
  FileListResponse,
  FileMoveRequest,
  FileMoveResponse,
  FileReadResponse,
  FileRestoreRequest,
  FileRestoreResponse,
  FileSearchQuery,
  FileSearchResponse,
  FileTrashResponse,
  FileVersionListResponse,
  FileVersionRestoreRequest,
  FileVersionRestoreResponse,
  FolderAccessResponse,
  FolderAccessSetRequest,
  FolderAccessSetResponse,
  FolderCreateRequest,
  FolderCreateResponse,
  FolderGrantRevokeResponse,
  FolderGrantSetRequest,
  FolderGrantSetResponse,
  FolderManagerRecoverRequest,
  FolderManagerRecoverResponse,
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
  PasswordResetRequest,
  PasswordResetResponse,
  PersonalQuotaSetRequest,
  PersonalQuotaSetResponse,
  RefreshRequest,
  RefreshResponse,
  RegisterRequest,
  RegisterResponse,
  SpaceListResponse,
  SpaceReadResponse,
  SpaceUsageResponse,
  UploadCancelResponse,
  UploadCompleteRequest,
  UploadCompleteResponse,
  UploadCreateRequest,
  UploadCreateResponse,
  UploadListResponse,
  UploadPartUrlsRequest,
  UploadPartUrlsResponse,
  UploadReadResponse,
  VerificationSendRequest,
  VerificationSendResponse,
  WhoAmIResponse,
  type ErrorCode,
} from "@tashan/contracts";

import type { HttpMethod, Transport } from "./transport.js";

const CapabilityListResponse = z.object({ items: z.array(Capability) }).strict();

type MaybePromise<T> = T | Promise<T>;

export interface SdkCredentialStore {
  getAccessToken(): MaybePromise<string | undefined>;
  getRefreshToken(): MaybePromise<string | undefined>;
  updateTokens(tokens: { accessToken: string; refreshToken?: string }): MaybePromise<void>;
  clearTokens(): MaybePromise<void>;
}

export interface OrgSpaceClientOptions {
  transport: Transport;
  credentials: SdkCredentialStore;
  deviceId: string;
  clientChannel: "web" | "cli";
  invocationSource: "web" | "cli" | "ai_via_cli";
  refreshMode?: "token" | "cookie";
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

type MutationOptions = { idempotencyKey: string; signal?: AbortSignal };

function pathId(raw: string): string {
  return encodeURIComponent(z.uuid().parse(raw));
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
      "x-torg-request-id": crypto.randomUUID(),
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
          crypto.randomUUID(),
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
    const cookieMode = options.refreshMode === "cookie";
    const refreshToken = cookieMode ? undefined : await options.credentials.getRefreshToken();
    if (!cookieMode && refreshToken === undefined) {
      throw new OrgSpaceApiError(
        "AUTH_REQUIRED",
        401,
        "refresh token is unavailable",
        crypto.randomUUID(),
      );
    }
    const body = RefreshRequest.parse(cookieMode ? {} : { refreshToken });
    const refreshed = await request("POST", "/v1/auth/refresh", RefreshResponse, body, {
      signal,
      allowRefresh: false,
    });
    await options.credentials.updateTokens(
      cookieMode
        ? { accessToken: refreshed.tokens.accessToken }
        : {
            accessToken: refreshed.tokens.accessToken,
            refreshToken: refreshed.tokens.refreshToken,
          },
    );
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

    register: async (
      input: unknown,
      mutation: { idempotencyKey: string; signal?: AbortSignal },
    ) => {
      const body = RegisterRequest.parse(input);
      const registered = await request(
        "POST",
        "/v1/auth/register",
        RegisterResponse,
        body,
        mutation,
      );
      await options.credentials.updateTokens(
        options.refreshMode === "cookie"
          ? { accessToken: registered.tokens.accessToken }
          : {
              accessToken: registered.tokens.accessToken,
              refreshToken: registered.tokens.refreshToken,
            },
      );
      return registered;
    },

    sendVerificationCode: (
      input: unknown,
      mutation: { idempotencyKey: string; signal?: AbortSignal },
    ) => {
      const body = VerificationSendRequest.parse(input);
      return request(
        "POST",
        "/v1/auth/verification/send",
        VerificationSendResponse,
        body,
        mutation,
      );
    },

    resetPassword: async (
      input: unknown,
      mutation: { idempotencyKey: string; signal?: AbortSignal },
    ) => {
      const body = PasswordResetRequest.parse(input);
      const reset = await request(
        "POST",
        "/v1/auth/password/reset",
        PasswordResetResponse,
        body,
        mutation,
      );
      await options.credentials.clearTokens();
      return reset;
    },

    login: async (input: unknown, signal?: AbortSignal) => {
      const body = LoginRequest.parse(input);
      const loggedIn = await request("POST", "/v1/auth/login", LoginResponse, body, { signal });
      await options.credentials.updateTokens(
        options.refreshMode === "cookie"
          ? { accessToken: loggedIn.tokens.accessToken }
          : {
              accessToken: loggedIn.tokens.accessToken,
              refreshToken: loggedIn.tokens.refreshToken,
            },
      );
      return loggedIn;
    },

    refresh: async (input?: unknown, signal?: AbortSignal) => {
      if (input === undefined) return refreshStoredTokens(signal);
      const body = RefreshRequest.parse(input);
      const refreshed = await request("POST", "/v1/auth/refresh", RefreshResponse, body, {
        signal,
        allowRefresh: false,
      });
      await options.credentials.updateTokens({
        accessToken: refreshed.tokens.accessToken,
        refreshToken: refreshed.tokens.refreshToken,
      });
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

    listSpaces: (signal?: AbortSignal) =>
      request("GET", "/v1/spaces", SpaceListResponse, undefined, { authenticated: true, signal }),

    readSpace: (spaceId: string, signal?: AbortSignal) =>
      request("GET", `/v1/spaces/${pathId(spaceId)}`, SpaceReadResponse, undefined, {
        authenticated: true,
        signal,
      }),

    readSpaceUsage: (spaceId: string, signal?: AbortSignal) =>
      request("GET", `/v1/spaces/${pathId(spaceId)}/usage`, SpaceUsageResponse, undefined, {
        authenticated: true,
        signal,
      }),

    setPersonalSpaceQuota: (
      organizationId: string,
      accountId: string,
      input: unknown,
      mutation: { idempotencyKey: string; signal?: AbortSignal },
    ) =>
      request(
        "POST",
        `/v1/organizations/${pathId(organizationId)}/members/${pathId(accountId)}/personal-space-quota`,
        PersonalQuotaSetResponse,
        PersonalQuotaSetRequest.parse(input),
        { ...mutation, authenticated: true },
      ),

    listFiles: (spaceId: string, input: unknown, signal?: AbortSignal) => {
      const query = FileListQuery.parse(input);
      const search = new URLSearchParams({
        parentId: query.parentId,
        includeTrash: String(query.includeTrash),
        limit: String(query.limit),
      });
      if (query.cursor !== undefined) search.set("cursor", query.cursor);
      return request(
        "GET",
        `/v1/spaces/${pathId(spaceId)}/entries?${search}`,
        FileListResponse,
        undefined,
        { authenticated: true, signal },
      );
    },

    readFile: (spaceId: string, entryId: string, signal?: AbortSignal) =>
      request(
        "GET",
        `/v1/spaces/${pathId(spaceId)}/entries/${pathId(entryId)}`,
        FileReadResponse,
        undefined,
        { authenticated: true, signal },
      ),

    searchFiles: (spaceId: string, input: unknown, signal?: AbortSignal) => {
      const query = FileSearchQuery.parse(input);
      const search = new URLSearchParams({ query: query.query, limit: String(query.limit) });
      if (query.cursor !== undefined) search.set("cursor", query.cursor);
      return request(
        "GET",
        `/v1/spaces/${pathId(spaceId)}/search?${search}`,
        FileSearchResponse,
        undefined,
        { authenticated: true, signal },
      );
    },

    createFolder: (spaceId: string, input: unknown, mutation: MutationOptions) =>
      request(
        "POST",
        `/v1/spaces/${pathId(spaceId)}/folders`,
        FolderCreateResponse,
        FolderCreateRequest.parse(input),
        { ...mutation, authenticated: true },
      ),

    moveFile: (spaceId: string, entryId: string, input: unknown, mutation: MutationOptions) =>
      request(
        "POST",
        `/v1/spaces/${pathId(spaceId)}/entries/${pathId(entryId)}/move`,
        FileMoveResponse,
        FileMoveRequest.parse(input),
        { ...mutation, authenticated: true },
      ),

    trashFile: (spaceId: string, entryId: string, mutation: MutationOptions) =>
      request(
        "POST",
        `/v1/spaces/${pathId(spaceId)}/entries/${pathId(entryId)}/trash`,
        FileTrashResponse,
        {},
        {
          ...mutation,
          authenticated: true,
        },
      ),

    restoreFile: (spaceId: string, entryId: string, input: unknown, mutation: MutationOptions) =>
      request(
        "POST",
        `/v1/spaces/${pathId(spaceId)}/entries/${pathId(entryId)}/restore`,
        FileRestoreResponse,
        FileRestoreRequest.parse(input),
        { ...mutation, authenticated: true },
      ),

    deleteFile: (spaceId: string, entryId: string, mutation: MutationOptions) =>
      request(
        "DELETE",
        `/v1/spaces/${pathId(spaceId)}/entries/${pathId(entryId)}`,
        FileDeleteResponse,
        undefined,
        {
          ...mutation,
          authenticated: true,
        },
      ),

    createFileDownload: (spaceId: string, entryId: string, mutation: MutationOptions) =>
      request(
        "POST",
        `/v1/spaces/${pathId(spaceId)}/entries/${pathId(entryId)}/download`,
        FileDownloadResponse,
        {},
        { ...mutation, authenticated: true },
      ),

    listFileVersions: (spaceId: string, entryId: string, signal?: AbortSignal) =>
      request(
        "GET",
        `/v1/spaces/${pathId(spaceId)}/entries/${pathId(entryId)}/versions`,
        FileVersionListResponse,
        undefined,
        { authenticated: true, signal },
      ),

    restoreFileVersion: (
      spaceId: string,
      entryId: string,
      versionId: string,
      input: unknown,
      mutation: MutationOptions,
    ) =>
      request(
        "POST",
        `/v1/spaces/${pathId(spaceId)}/entries/${pathId(entryId)}/versions/${pathId(versionId)}/restore`,
        FileVersionRestoreResponse,
        FileVersionRestoreRequest.parse(input),
        { ...mutation, authenticated: true },
      ),

    listUploads: (spaceId: string, signal?: AbortSignal) =>
      request("GET", `/v1/spaces/${pathId(spaceId)}/uploads`, UploadListResponse, undefined, {
        authenticated: true,
        signal,
      }),

    readUpload: (spaceId: string, uploadId: string, signal?: AbortSignal) =>
      request(
        "GET",
        `/v1/spaces/${pathId(spaceId)}/uploads/${pathId(uploadId)}`,
        UploadReadResponse,
        undefined,
        {
          authenticated: true,
          signal,
        },
      ),

    createUpload: (spaceId: string, input: unknown, mutation: MutationOptions) =>
      request(
        "POST",
        `/v1/spaces/${pathId(spaceId)}/uploads`,
        UploadCreateResponse,
        UploadCreateRequest.parse(input),
        { ...mutation, authenticated: true },
      ),

    createUploadPartUrls: (
      spaceId: string,
      uploadId: string,
      input: unknown,
      mutation: MutationOptions,
    ) =>
      request(
        "POST",
        `/v1/spaces/${pathId(spaceId)}/uploads/${pathId(uploadId)}/parts`,
        UploadPartUrlsResponse,
        UploadPartUrlsRequest.parse(input),
        { ...mutation, authenticated: true },
      ),

    completeUpload: (
      spaceId: string,
      uploadId: string,
      input: unknown,
      mutation: MutationOptions,
    ) =>
      request(
        "POST",
        `/v1/spaces/${pathId(spaceId)}/uploads/${pathId(uploadId)}/complete`,
        UploadCompleteResponse,
        UploadCompleteRequest.parse(input),
        { ...mutation, authenticated: true },
      ),

    cancelUpload: (spaceId: string, uploadId: string, mutation: MutationOptions) =>
      request(
        "POST",
        `/v1/spaces/${pathId(spaceId)}/uploads/${pathId(uploadId)}/cancel`,
        UploadCancelResponse,
        {},
        { ...mutation, authenticated: true },
      ),

    readFolderAccess: (spaceId: string, folderId: string, signal?: AbortSignal) =>
      request(
        "GET",
        `/v1/spaces/${pathId(spaceId)}/folders/${pathId(folderId)}/access`,
        FolderAccessResponse,
        undefined,
        { authenticated: true, signal },
      ),

    setFolderAccess: (
      spaceId: string,
      folderId: string,
      input: unknown,
      mutation: MutationOptions,
    ) =>
      request(
        "POST",
        `/v1/spaces/${pathId(spaceId)}/folders/${pathId(folderId)}/access`,
        FolderAccessSetResponse,
        FolderAccessSetRequest.parse(input),
        { ...mutation, authenticated: true },
      ),

    setFolderGrant: (
      spaceId: string,
      folderId: string,
      input: unknown,
      mutation: MutationOptions,
    ) =>
      request(
        "POST",
        `/v1/spaces/${pathId(spaceId)}/folders/${pathId(folderId)}/grants`,
        FolderGrantSetResponse,
        FolderGrantSetRequest.parse(input),
        { ...mutation, authenticated: true },
      ),

    revokeFolderGrant: (
      spaceId: string,
      folderId: string,
      accountId: string,
      mutation: MutationOptions,
    ) =>
      request(
        "DELETE",
        `/v1/spaces/${pathId(spaceId)}/folders/${pathId(folderId)}/grants/${pathId(accountId)}`,
        FolderGrantRevokeResponse,
        undefined,
        { ...mutation, authenticated: true },
      ),

    recoverFolderManager: (
      spaceId: string,
      folderId: string,
      input: unknown,
      mutation: MutationOptions,
    ) =>
      request(
        "POST",
        `/v1/spaces/${pathId(spaceId)}/folders/${pathId(folderId)}/manager-recovery`,
        FolderManagerRecoverResponse,
        FolderManagerRecoverRequest.parse(input),
        { ...mutation, authenticated: true },
      ),

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
