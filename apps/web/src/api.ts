import { createFetchTransport, createOrgSpaceClient, type SdkCredentialStore } from "@tashan/sdk";

class WebMemoryCredentials implements SdkCredentialStore {
  private accessToken: string | undefined;

  public getAccessToken(): string | undefined {
    return this.accessToken;
  }

  public getRefreshToken(): string | undefined {
    return undefined;
  }

  public updateTokens(tokens: { accessToken: string }): void {
    this.accessToken = tokens.accessToken;
  }

  public clearTokens(): void {
    this.accessToken = undefined;
  }
}

export function createWebClient(apiUrl: string, deviceId: string) {
  return createOrgSpaceClient({
    transport: createFetchTransport({
      baseUrl: apiUrl,
      timeoutMilliseconds: 15_000,
      credentials: "include",
    }),
    credentials: new WebMemoryCredentials(),
    deviceId,
    clientChannel: "web",
    invocationSource: "web",
    refreshMode: "cookie",
  });
}
