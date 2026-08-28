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
  const account = {
    id: accountId,
    displayName: "用户8000",
    phone: "+8613800138000",
    phoneVerifiedAt: "2026-08-18T12:00:00.000Z",
    status: "active",
    createdAt: "2026-08-18T12:00:00.000Z",
  };
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
          displayName: "用户8000",
          role: "org_admin",
          status: "active",
        },
      ],
    }),
    listDevices: vi.fn().mockResolvedValue({
      items: [
        {
          id: currentDeviceId,
          name: "当前 MacBook",
          os: "macOS",
          architecture: "arm64",
          clientVersion: "0.1.0-alpha.3",
          lastSeenAt: "2026-08-19T00:00:00.000Z",
          current: true,
          revokedAt: null,
        },
        {
          id: otherDeviceId,
          name: "MacBook Air",
          os: "macOS",
          architecture: "arm64",
          clientVersion: "0.1.0-alpha.3",
          lastSeenAt: "2026-08-18T00:00:00.000Z",
          current: false,
          revokedAt: null,
        },
      ],
    }),
    revokeDevice: vi
      .fn()
      .mockResolvedValue({ deviceId: otherDeviceId, revokedAt: "2026-08-18T12:00:00.000Z" }),
    register: vi.fn().mockResolvedValue({ account }),
    sendVerificationCode: vi.fn().mockResolvedValue({
      challengeId: "f27afaa3-858f-46f5-b01a-4c702b5ce1c6",
      expiresAt: "2026-08-18T12:10:00.000Z",
    }),
    resetPassword: vi.fn().mockResolvedValue({ reset: true }),
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
  await screen.findByRole("heading", { name: "登录" });
  await user.type(screen.getByLabelText("手机号"), "13800138000");
  await user.type(screen.getByLabelText("密码"), "CorrectHorseBattery9");
  await user.click(screen.getByRole("button", { name: "登录" }));
  await screen.findByRole("heading", { name: "组织首页" });
}

describe("routed Phase 0 Web", () => {
  test("restores a cookie session into the organization home without login flicker", async () => {
    const sdk = client({ refresh: vi.fn().mockResolvedValue({}) });
    renderApp(sdk);
    expect(screen.getByText("正在登录…")).toBeVisible();
    expect(screen.queryByRole("heading", { name: "登录" })).not.toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "组织首页" })).toBeVisible();
    expect(screen.getAllByRole("link", { name: "任务" })[0]).toBeVisible();
  });

  test("shows invalid credentials as a focused error with request ID", async () => {
    const sdk = client({
      login: vi
        .fn()
        .mockRejectedValue(
          new OrgSpaceApiError("AUTH_INVALID_CREDENTIALS", 401, "手机号或密码不正确", requestId),
        ),
    });
    renderApp(sdk);
    const user = userEvent.setup();
    await screen.findByRole("heading", { name: "登录" });
    await user.type(screen.getByLabelText("手机号"), "13800138000");
    await user.type(screen.getByLabelText("密码"), "IncorrectPassword9");
    await user.click(screen.getByRole("button", { name: "登录" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("手机号或密码不正确");
    expect(alert).toHaveTextContent(requestId);
    expect(alert).toHaveFocus();
  });

  test("revokes another device from the account page", async () => {
    const sdk = client();
    await login(sdk);
    const user = userEvent.setup();
    await user.click(screen.getByRole("link", { name: "账号与设备" }));
    expect(await screen.findByRole("navigation", { name: "主导航" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "账号与设备" })).toBeVisible();
    expect(screen.getByText("查看和管理登录设备")).toBeVisible();
    expect(screen.queryByText("0.1.0-alpha.3")).not.toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: /MacBook Air.*可用/ }));
    const detail = screen.getByRole("dialog", { name: "MacBook Air" });
    expect(detail).toBeVisible();
    expect(screen.getByRole("heading", { name: "账号与设备", hidden: true })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "技术信息" })).toHaveTextContent("0.1.0-alpha.3");
    await user.keyboard("{Escape}");
    await user.click(await screen.findByRole("button", { name: "撤销 MacBook Air" }));
    const dialog = screen.getByRole("dialog", { name: "撤销 MacBook Air？" });
    expect(dialog).toContainElement(document.activeElement as HTMLElement | null);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "撤销 MacBook Air？" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "撤销 MacBook Air" }));
    await user.click(screen.getByRole("button", { name: "确认撤销" }));
    expect(await screen.findByText("设备已撤销")).toBeVisible();
    expect(sdk.revokeDevice).toHaveBeenCalledWith(
      otherDeviceId,
      expect.objectContaining({ idempotencyKey: expect.stringMatching(/^web-device-revoke-/) }),
    );
  });

  test("registers a verified phone account and enters the organization area", async () => {
    const sdk = client();
    renderApp(sdk);
    const user = userEvent.setup();
    await screen.findByRole("heading", { name: "登录" });
    await user.click(screen.getByRole("tab", { name: "创建账号" }));
    await user.type(screen.getByLabelText("手机号"), "13800138000");
    await user.click(screen.getByRole("button", { name: "发送验证码" }));
    await user.type(screen.getByLabelText("验证码"), "123456");
    await user.type(screen.getByLabelText("设置密码"), "CorrectHorseBattery9");
    await user.click(screen.getByRole("button", { name: "注册并进入空间" }));
    expect(await screen.findByRole("heading", { name: "组织首页" })).toBeVisible();
    expect(sdk.register).toHaveBeenCalledWith(
      expect.objectContaining({
        phone: "13800138000",
        challengeId: "f27afaa3-858f-46f5-b01a-4c702b5ce1c6",
        code: "123456",
      }),
      expect.objectContaining({ idempotencyKey: expect.stringMatching(/^web-register-/) }),
    );
  });

  test("keeps the personal runtime direction on an inert coming-soon route", async () => {
    const sdk = client();
    renderApp(sdk, "/personal/runtime");
    const user = userEvent.setup();
    await screen.findByRole("heading", { name: "登录" });
    await user.type(screen.getByLabelText("手机号"), "13800138000");
    await user.type(screen.getByLabelText("密码"), "CorrectHorseBattery9");
    await user.click(screen.getByRole("button", { name: "登录" }));

    const heading = await screen.findByRole("heading", { name: "个人运行与构建" });
    const roadmap = heading.closest("article");
    expect(roadmap).not.toBeNull();
    if (roadmap === null) throw new Error("personal runtime roadmap is missing");
    expect(roadmap).toHaveTextContent("即将上线");
    expect(roadmap).toHaveTextContent("此功能暂未开放");
    expect(screen.getByRole("link", { name: "返回组织首页" })).toHaveAttribute(
      "href",
      `/org/${organizationId}/home`,
    );
    expect(roadmap.querySelector("form")).toBeNull();
    expect(roadmap.querySelector("button")).toBeNull();
  });

  test("keeps account controls available before the user joins an organization", async () => {
    const sdk = client({
      listOrganizations: vi.fn().mockResolvedValue({ items: [] }),
    });
    await login(sdk);
    expect(screen.getByRole("img", { name: "他山组织空间" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "组织首页" })).toBeVisible();
    expect(screen.getByRole("button", { name: "创建组织" })).toBeVisible();
    expect(screen.getByRole("button", { name: "退出登录" })).toBeVisible();
  });

  test("keeps the account page inside the account-only shell without an organization", async () => {
    const sdk = client({
      listOrganizations: vi.fn().mockResolvedValue({ items: [] }),
    });
    renderApp(sdk, "/account");
    const user = userEvent.setup();
    await screen.findByRole("heading", { name: "登录" });
    await user.type(screen.getByLabelText("手机号"), "13800138000");
    await user.type(screen.getByLabelText("密码"), "CorrectHorseBattery9");
    await user.click(screen.getByRole("button", { name: "登录" }));
    expect(await screen.findByRole("heading", { name: "账号与设备" })).toBeVisible();
    expect(screen.getByRole("img", { name: "他山组织空间" })).toBeVisible();
    expect(screen.getByRole("button", { name: "退出登录" })).toBeVisible();
  });

  test("shows the API reason when organization creation is rejected", async () => {
    const sdk = client({
      createOrganization: vi
        .fn()
        .mockRejectedValue(
          new OrgSpaceApiError("ORG_FORBIDDEN", 403, "当前账号不能创建组织", requestId),
        ),
    });
    await login(sdk);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "创建组织" }));
    await user.type(screen.getByLabelText("新组织名称"), "研究组");
    await user.click(screen.getByRole("button", { name: "创建组织" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("当前账号不能创建组织");
  });
});
