import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, test, vi } from "vitest";

import { DeviceLoginMetadata } from "@tashan/contracts";
import { OrgSpaceApiError, type OrgSpaceClient } from "@tashan/sdk";

import { App } from "./app.js";

afterEach(cleanup);

const accountId = "b228e557-2214-4f95-b49d-d4ff7d9759d4";
const currentDeviceId = "35f503c2-a5d7-4250-a337-4f4fd03cf8df";
const otherDeviceId = "84ecfe2e-c11a-4a56-8735-934955bef834";
const organizationId = "95d5579d-a32d-4650-aec4-318ff3a55df1";
const requestId = "bb310eb3-d828-4c4b-99fa-7e0f510cdb90";

function rejectedAuth() {
  return new OrgSpaceApiError("AUTH_REQUIRED", 401, "authentication is required", requestId);
}

function client(overrides: Record<string, unknown> = {}): OrgSpaceClient {
  const account = { id: accountId, username: "alice", phone: null, phoneVerifiedAt: null };
  return {
    login: vi.fn().mockResolvedValue({ account }),
    refresh: vi.fn().mockRejectedValue(rejectedAuth()),
    whoami: vi.fn().mockResolvedValue({ account }),
    listOrganizations: vi.fn().mockResolvedValue({
      items: [{ id: organizationId, name: "他山协会", status: "active" }],
    }),
    listMembers: vi.fn().mockResolvedValue({
      items: [
        {
          id: "membership-1",
          accountId,
          organizationId,
          username: "alice",
          role: "org_admin",
          status: "active",
        },
      ],
    }),
    listDevices: vi.fn().mockResolvedValue({
      items: [
        { id: currentDeviceId, name: "当前 MacBook", current: true, revokedAt: null },
        { id: otherDeviceId, name: "MacBook Air", current: false, revokedAt: null },
      ],
    }),
    revokeDevice: vi
      .fn()
      .mockResolvedValue({ deviceId: otherDeviceId, revokedAt: "2026-08-18T12:00:00.000Z" }),
    register: vi.fn().mockResolvedValue({ account }),
    startPhoneVerification: vi
      .fn()
      .mockResolvedValue({ challengeId: "f27afaa3-858f-46f5-b01a-4c702b5ce1c6" }),
    confirmPhoneVerification: vi
      .fn()
      .mockResolvedValue({ phone: "+8613800138001", verifiedAt: "2026-08-18T12:01:00.000Z" }),
    createOrganization: vi.fn(),
    addMember: vi.fn(),
    listAuditEvents: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
    logout: vi.fn().mockResolvedValue({ loggedOut: true }),
    ...overrides,
  } as unknown as OrgSpaceClient;
}

const device = DeviceLoginMetadata.parse({
  id: currentDeviceId,
  name: "Browser test",
  os: "test",
  architecture: "browser",
  clientVersion: "0.0.0",
  channel: "web",
});

function renderApp(sdk: OrgSpaceClient, path = "/") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App sdk={sdk} device={device} />
    </MemoryRouter>,
  );
}

async function login(sdk: OrgSpaceClient): Promise<void> {
  const user = userEvent.setup();
  renderApp(sdk);
  await screen.findByRole("heading", { name: "登录组织空间" });
  await user.type(screen.getByLabelText("用户名"), "alice");
  await user.type(screen.getByLabelText("密码"), "secret123");
  await user.click(screen.getByRole("button", { name: "登录" }));
  await screen.findByRole("heading", { name: "组织首页" });
}

describe("routed Phase 0 Web", () => {
  test("restores a cookie session into the organization home without login flicker", async () => {
    const sdk = client({ refresh: vi.fn().mockResolvedValue({}) });
    renderApp(sdk);
    expect(screen.getByText("正在恢复安全会话…")).toBeVisible();
    expect(screen.queryByRole("heading", { name: "登录组织空间" })).not.toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "组织首页" })).toBeVisible();
    expect(screen.getByRole("link", { name: /任务.*即将上线/ })).toBeVisible();
  });

  test("shows invalid credentials as a focused error with request ID", async () => {
    const sdk = client({
      login: vi
        .fn()
        .mockRejectedValue(
          new OrgSpaceApiError("AUTH_INVALID_CREDENTIALS", 401, "用户名或密码不正确", requestId),
        ),
    });
    renderApp(sdk);
    const user = userEvent.setup();
    await screen.findByRole("heading", { name: "登录组织空间" });
    await user.type(screen.getByLabelText("用户名"), "alice");
    await user.type(screen.getByLabelText("密码"), "wrongpass");
    await user.click(screen.getByRole("button", { name: "登录" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("用户名或密码不正确");
    expect(alert).toHaveTextContent(requestId);
    expect(alert).toHaveFocus();
  });

  test("revokes another device from the account page", async () => {
    const sdk = client();
    await login(sdk);
    const user = userEvent.setup();
    await user.click(screen.getByRole("link", { name: "账号与设备" }));
    await user.click(await screen.findByRole("button", { name: "撤销 MacBook Air" }));
    await user.click(screen.getByRole("button", { name: "确认撤销" }));
    expect(await screen.findByText("设备已撤销")).toBeVisible();
    expect(sdk.revokeDevice).toHaveBeenCalledWith(
      otherDeviceId,
      expect.objectContaining({ idempotencyKey: expect.stringMatching(/^web-device-revoke-/) }),
    );
  });

  test("registers an account and returns to login", async () => {
    const sdk = client();
    renderApp(sdk);
    const user = userEvent.setup();
    await screen.findByRole("heading", { name: "登录组织空间" });
    await user.click(screen.getByRole("button", { name: "还没有账号？创建账号" }));
    await user.type(screen.getByLabelText("用户名"), "alice");
    await user.type(screen.getByLabelText("密码"), "CorrectHorseBattery9");
    await user.click(screen.getByRole("button", { name: "注册" }));
    expect(await screen.findByText("账号已创建，请登录后验证手机号。")).toBeVisible();
  });

  test("shows the API reason when organization creation is rejected", async () => {
    const sdk = client({
      createOrganization: vi
        .fn()
        .mockRejectedValue(
          new OrgSpaceApiError("PHONE_NOT_VERIFIED", 403, "创建组织前需要先验证手机号", requestId),
        ),
    });
    await login(sdk);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("新组织名称"), "研究组");
    await user.click(screen.getByRole("button", { name: "创建组织" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("创建组织前需要先验证手机号");
  });
});
