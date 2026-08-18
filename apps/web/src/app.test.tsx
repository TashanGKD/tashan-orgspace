import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";

import { OrgSpaceApiError, type OrgSpaceClient } from "@tashan/sdk";

import { App } from "./app.js";

afterEach(cleanup);

const accountId = "b228e557-2214-4f95-b49d-d4ff7d9759d4";
const principalId = "af4ec631-8335-4c2b-9a02-df7033d45c55";
const sessionId = "3c5442ea-00e2-483b-9e81-2271e34120f1";
const currentDeviceId = "35f503c2-a5d7-4250-a337-4f4fd03cf8df";
const otherDeviceId = "84ecfe2e-c11a-4a56-8735-934955bef834";
const organizationId = "95d5579d-a32d-4650-aec4-318ff3a55df1";

function client(overrides: Record<string, unknown> = {}): OrgSpaceClient {
  return {
    login: vi.fn().mockResolvedValue({
      account: { id: accountId, username: "alice", phone: null, phoneVerifiedAt: null },
      principal: { id: principalId, type: "human", accountId },
      sessionId,
      deviceId: currentDeviceId,
      tokens: {},
    }),
    refresh: vi
      .fn()
      .mockRejectedValue(
        new OrgSpaceApiError(
          "AUTH_REQUIRED",
          401,
          "authentication is required",
          "bb310eb3-d828-4c4b-99fa-7e0f510cdb90",
        ),
      ),
    whoami: vi.fn().mockResolvedValue({
      account: { id: accountId, username: "alice", phone: null, phoneVerifiedAt: null },
      principal: { id: principalId, type: "human", accountId },
      sessionId,
      deviceId: currentDeviceId,
    }),
    listOrganizations: vi.fn().mockResolvedValue({
      items: [{ id: organizationId, name: "他山协会", status: "active" }],
    }),
    listDevices: vi.fn().mockResolvedValue({
      items: [
        { id: currentDeviceId, name: "当前 MacBook", current: true, revokedAt: null },
        { id: otherDeviceId, name: "MacBook Air", current: false, revokedAt: null },
      ],
    }),
    revokeDevice: vi.fn().mockResolvedValue({
      deviceId: otherDeviceId,
      revokedAt: "2026-08-18T12:00:00.000Z",
    }),
    register: vi.fn().mockResolvedValue({
      account: { id: accountId, username: "alice", phone: null, phoneVerifiedAt: null },
      principal: { id: principalId, type: "human", accountId },
    }),
    startPhoneVerification: vi.fn().mockResolvedValue({
      challengeId: "f27afaa3-858f-46f5-b01a-4c702b5ce1c6",
      expiresAt: "2026-08-18T12:05:00.000Z",
    }),
    confirmPhoneVerification: vi.fn().mockResolvedValue({
      phone: "+8613800138001",
      verifiedAt: "2026-08-18T12:01:00.000Z",
    }),
    createOrganization: vi.fn(),
    logout: vi.fn().mockResolvedValue({ loggedOut: true }),
    ...overrides,
  } as unknown as OrgSpaceClient;
}

const device = {
  id: currentDeviceId,
  name: "Browser test",
  os: "test",
  architecture: "test",
  clientVersion: "0.0.0",
  channel: "web" as const,
};

async function login(sdk: OrgSpaceClient): Promise<void> {
  const user = userEvent.setup();
  render(<App sdk={sdk} device={device} />);
  await user.type(screen.getByLabelText("用户名"), "alice");
  await user.type(screen.getByLabelText("密码"), "secret");
  await user.click(screen.getByRole("button", { name: "登录" }));
  await screen.findByText("alice");
}

describe("Phase 0 Web shell", () => {
  test("restores a Web session from the HttpOnly cookie without another login", async () => {
    const sdk = client({ refresh: vi.fn().mockResolvedValue({}) });
    render(<App sdk={sdk} device={device} />);
    expect(await screen.findByText("alice")).toBeVisible();
    expect(sdk.refresh).toHaveBeenCalledOnce();
    expect(sdk.login).not.toHaveBeenCalled();
  });

  test("logs in, selects an organization, and revokes another device", async () => {
    const sdk = client();
    const user = userEvent.setup();
    render(<App sdk={sdk} device={device} />);
    await user.type(screen.getByLabelText("用户名"), "alice");
    await user.type(screen.getByLabelText("密码"), "secret");
    await user.click(screen.getByRole("button", { name: "登录" }));
    await user.selectOptions(await screen.findByLabelText("当前组织"), organizationId);
    await user.click(screen.getByRole("button", { name: "撤销 MacBook Air" }));
    await user.click(screen.getByRole("button", { name: "确认撤销" }));
    expect(await screen.findByText("设备已撤销")).toBeVisible();
    expect(sdk.revokeDevice).toHaveBeenCalledWith(
      otherDeviceId,
      expect.objectContaining({ idempotencyKey: expect.any(String) }),
    );
  });

  test("shows invalid credentials as a focused accessible error", async () => {
    const sdk = client({
      login: vi
        .fn()
        .mockRejectedValue(
          new OrgSpaceApiError(
            "AUTH_INVALID_CREDENTIALS",
            401,
            "用户名或密码不正确",
            "bb310eb3-d828-4c4b-99fa-7e0f510cdb90",
          ),
        ),
    });
    const user = userEvent.setup();
    render(<App sdk={sdk} device={device} />);
    await user.type(screen.getByLabelText("用户名"), "alice");
    await user.type(screen.getByLabelText("密码"), "wrong");
    await user.click(screen.getByRole("button", { name: "登录" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("用户名或密码不正确");
    expect(alert).toHaveFocus();
  });

  test("protects the current device and exposes a loading state", async () => {
    let finishLogin: (() => void) | undefined;
    const pendingLogin = new Promise<void>((resolve) => {
      finishLogin = resolve;
    });
    const sdk = client({
      login: vi.fn(async () => {
        await pendingLogin;
        return { account: { username: "alice" } };
      }),
    });
    const user = userEvent.setup();
    render(<App sdk={sdk} device={device} />);
    await user.type(screen.getByLabelText("用户名"), "alice");
    await user.type(screen.getByLabelText("密码"), "secret");
    await user.click(screen.getByRole("button", { name: "登录" }));
    expect(screen.getByRole("button", { name: "正在登录…" })).toBeDisabled();
    finishLogin?.();
    await screen.findByText("alice");
    expect(screen.getByRole("button", { name: "当前设备不可撤销" })).toBeDisabled();
  });

  test("explains that phone verification is required for organization creation", async () => {
    const sdk = client({
      createOrganization: vi
        .fn()
        .mockRejectedValue(
          new OrgSpaceApiError(
            "PHONE_NOT_VERIFIED",
            403,
            "创建组织前需要先验证手机号",
            "bb310eb3-d828-4c4b-99fa-7e0f510cdb90",
          ),
        ),
    });
    await login(sdk);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("新组织名称"), "研究组");
    await user.click(screen.getByRole("button", { name: "创建组织" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("创建组织前需要先验证手机号");
  });

  test("registers, verifies a phone, and logs out through accessible controls", async () => {
    const sdk = client();
    const user = userEvent.setup();
    const first = render(<App sdk={sdk} device={device} />);
    await user.click(screen.getByRole("button", { name: "还没有账号？创建账号" }));
    await user.type(screen.getByLabelText("用户名"), "alice");
    await user.type(screen.getByLabelText("密码"), "CorrectHorseBattery9");
    await user.click(screen.getByRole("button", { name: "注册" }));
    expect(await screen.findByText("账号已创建，请登录后验证手机号。")).toBeVisible();
    expect(sdk.register).toHaveBeenCalledWith(
      { username: "alice", password: "CorrectHorseBattery9" },
      expect.objectContaining({ idempotencyKey: expect.any(String) }),
    );

    first.unmount();
    await login(sdk);
    await user.type(screen.getByLabelText("手机号"), "+8613800138001");
    await user.click(screen.getByRole("button", { name: "发送验证码" }));
    await user.type(await screen.findByLabelText("验证码"), "123456");
    await user.click(screen.getByRole("button", { name: "确认验证" }));
    expect(await screen.findByText("手机号已验证")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "退出" }));
    expect(await screen.findByRole("heading", { name: "登录组织空间" })).toBeVisible();
    expect(sdk.logout).toHaveBeenCalledOnce();
  });
});
