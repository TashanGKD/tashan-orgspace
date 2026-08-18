import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { OrgSpaceApiError, type OrgSpaceClient } from "@tashan/sdk";
import { DeviceLoginMetadata } from "@tashan/contracts";

import { SessionProvider, useSession } from "./session-context.js";

afterEach(cleanup);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function authRequired() {
  return new OrgSpaceApiError(
    "AUTH_REQUIRED",
    401,
    "authentication is required",
    "bb310eb3-d828-4c4b-99fa-7e0f510cdb90",
  );
}

function client(overrides: Partial<OrgSpaceClient> = {}): OrgSpaceClient {
  return {
    refresh: vi.fn().mockRejectedValue(authRequired()),
    whoami: vi.fn().mockResolvedValue({
      account: { id: "account-1", username: "alice", phone: null, phoneVerifiedAt: null },
    }),
    ...overrides,
  } as unknown as OrgSpaceClient;
}

const device = DeviceLoginMetadata.parse({
  id: "35f503c2-a5d7-4250-a337-4f4fd03cf8df",
  name: "Browser test",
  os: "test",
  architecture: "browser",
  clientVersion: "0.0.0",
  channel: "web" as const,
});

function Probe() {
  const session = useSession();
  if (session.status === "restoring") return <p>正在恢复安全会话…</p>;
  if (session.status === "anonymous") return <h1>登录组织空间</h1>;
  return <strong>{session.account.username}</strong>;
}

describe("SessionProvider", () => {
  test("shows restoring state instead of flashing the login form", async () => {
    const restore = deferred<unknown>();
    const sdk = client({ refresh: vi.fn(() => restore.promise) as OrgSpaceClient["refresh"] });
    render(
      <SessionProvider sdk={sdk} device={device}>
        <Probe />
      </SessionProvider>,
    );
    expect(screen.getByText("正在恢复安全会话…")).toBeVisible();
    expect(screen.queryByRole("heading", { name: "登录组织空间" })).not.toBeInTheDocument();
    restore.reject(authRequired());
    expect(await screen.findByRole("heading", { name: "登录组织空间" })).toBeVisible();
  });

  test("never refreshes more than once during initial restoration", async () => {
    const sdk = client();
    render(
      <SessionProvider sdk={sdk} device={device}>
        <Probe />
      </SessionProvider>,
    );
    await screen.findByRole("heading", { name: "登录组织空间" });
    expect(sdk.refresh).toHaveBeenCalledOnce();
  });

  test("does not continue identity loading after unmount", async () => {
    const restore = deferred<unknown>();
    const sdk = client({ refresh: vi.fn(() => restore.promise) as OrgSpaceClient["refresh"] });
    const view = render(
      <SessionProvider sdk={sdk} device={device}>
        <Probe />
      </SessionProvider>,
    );
    view.unmount();
    restore.resolve({});
    await restore.promise;
    await Promise.resolve();
    expect(sdk.whoami).not.toHaveBeenCalled();
  });
});
