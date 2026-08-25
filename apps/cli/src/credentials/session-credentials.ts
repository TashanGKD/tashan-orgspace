import { randomUUID } from "node:crypto";

import { z } from "zod";

import type { SdkCredentialStore } from "@tashan/sdk";

import type { CredentialStore } from "./credential-store.js";

const StoredSession = z
  .object({
    version: z.literal(2),
    deviceId: z.uuid(),
    accessToken: z.string().min(1).optional(),
    refreshToken: z.string().min(32).optional(),
    accountId: z.uuid().optional(),
    displayName: z.string().min(1).optional(),
    phoneMasked: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.accessToken === undefined) !== (value.refreshToken === undefined)) {
      context.addIssue({ code: "custom", message: "stored token pair is incomplete" });
    }
  });

type StoredSession = z.infer<typeof StoredSession>;

export class CliSessionCredentials implements SdkCredentialStore {
  private constructor(
    private readonly store: CredentialStore,
    private readonly label: string,
    private state: StoredSession,
  ) {}

  public static async load(
    store: CredentialStore,
    label: string,
    preferredDeviceId?: string,
  ): Promise<CliSessionCredentials> {
    const raw = await store.read(label);
    if (raw === undefined) {
      return new CliSessionCredentials(store, label, {
        version: 2,
        deviceId: z.uuid().parse(preferredDeviceId ?? randomUUID()),
      });
    }
    const decoded = JSON.parse(raw) as unknown;
    if (
      typeof decoded === "object" &&
      decoded !== null &&
      (("version" in decoded && decoded.version === 1) || "username" in decoded)
    ) {
      throw new Error("legacy username session credentials are unsupported; log in again");
    }
    const state = StoredSession.parse(decoded);
    if (preferredDeviceId !== undefined && preferredDeviceId !== state.deviceId) {
      throw new Error("configured device ID does not match the stored session device");
    }
    return new CliSessionCredentials(store, label, state);
  }

  public get deviceId(): string {
    return this.state.deviceId;
  }

  public get displayName(): string | undefined {
    return this.state.displayName;
  }

  public async getAccessToken(): Promise<string | undefined> {
    return this.state.accessToken;
  }

  public async getRefreshToken(): Promise<string | undefined> {
    return this.state.refreshToken;
  }

  public async updateTokens(tokens: { accessToken: string; refreshToken?: string }): Promise<void> {
    if (tokens.refreshToken === undefined) {
      throw new Error("CLI credential updates require a refresh token");
    }
    this.state = {
      ...this.state,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    };
    await this.persist();
  }

  public async updateIdentity(input: {
    accountId: string;
    displayName: string;
    phone: string;
  }): Promise<void> {
    const phoneMasked =
      input.phone.length > 7 ? `${input.phone.slice(0, 4)}****${input.phone.slice(-4)}` : "****";
    this.state = {
      ...this.state,
      accountId: input.accountId,
      displayName: input.displayName,
      phoneMasked,
    };
    await this.persist();
  }

  public async clearTokens(): Promise<void> {
    const remaining = { ...this.state };
    delete remaining.accessToken;
    delete remaining.refreshToken;
    this.state = remaining;
    await this.persist();
  }

  private async persist(): Promise<void> {
    await this.store.write(this.label, JSON.stringify(this.state));
  }
}
