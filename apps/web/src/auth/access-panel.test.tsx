import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";

import { AccessPanel } from "./access-panel.js";

afterEach(cleanup);

function actions() {
  return {
    busy: false,
    onLogin: vi.fn().mockResolvedValue(undefined),
    onRegister: vi.fn().mockResolvedValue(undefined),
    onResetPassword: vi.fn().mockResolvedValue(undefined),
    onSendVerificationCode: vi.fn().mockResolvedValue({
      challengeId: "746fb70b-a27e-4a78-a231-aa55ef8c343e",
      expiresAt: "2026-08-19T00:10:00.000Z",
    }),
  };
}

describe("AccessPanel", () => {
  test("switching modes preserves phone but clears password and verification code", async () => {
    const props = actions();
    const user = userEvent.setup();
    render(<AccessPanel {...props} />);

    await user.type(screen.getByLabelText("手机号"), "13800138000");
    await user.type(screen.getByLabelText("密码"), "CorrectHorseBattery9");
    await user.click(screen.getByRole("tab", { name: "创建账号" }));
    expect(screen.getByLabelText("手机号")).toHaveValue("13800138000");
    expect(screen.getByLabelText("设置密码")).toHaveValue("");
    await user.type(screen.getByLabelText("验证码"), "123456");
    await user.click(screen.getByRole("tab", { name: "重置密码" }));
    expect(screen.getByLabelText("手机号")).toHaveValue("13800138000");
    expect(screen.getByLabelText("验证码")).toHaveValue("");
  });

  test("starts resend countdown only after verification API success", async () => {
    const props = actions();
    const user = userEvent.setup();
    render(<AccessPanel {...props} />);
    await user.click(screen.getByRole("tab", { name: "创建账号" }));
    await user.type(screen.getByLabelText("手机号"), "13800138000");
    await user.click(screen.getByRole("button", { name: "发送验证码" }));

    expect(props.onSendVerificationCode).toHaveBeenCalledWith("13800138000", "register");
    expect(await screen.findByRole("button", { name: /秒后可重发/ })).toBeDisabled();
  });

  test("submits a verified registration and leaves authentication state to the parent", async () => {
    const props = actions();
    const user = userEvent.setup();
    render(<AccessPanel {...props} />);
    await user.click(screen.getByRole("tab", { name: "创建账号" }));
    await user.type(screen.getByLabelText("手机号"), "13800138000");
    await user.click(screen.getByRole("button", { name: "发送验证码" }));
    await user.type(screen.getByLabelText("验证码"), "123456");
    await user.type(screen.getByLabelText("设置密码"), "CorrectHorseBattery9");
    await user.click(screen.getByRole("button", { name: "注册并进入空间" }));

    expect(props.onRegister).toHaveBeenCalledWith({
      phone: "13800138000",
      challengeId: "746fb70b-a27e-4a78-a231-aa55ef8c343e",
      code: "123456",
      password: "CorrectHorseBattery9",
    });
  });

  test("returns to login with the phone preserved after password reset", async () => {
    const props = actions();
    const user = userEvent.setup();
    render(<AccessPanel {...props} />);
    await user.click(screen.getByRole("tab", { name: "重置密码" }));
    await user.type(screen.getByLabelText("手机号"), "13800138000");
    await user.click(screen.getByRole("button", { name: "发送验证码" }));
    await user.type(screen.getByLabelText("验证码"), "123456");
    await user.type(screen.getByLabelText("新密码"), "AnotherStrongPassword9");
    await user.click(screen.getByRole("button", { name: "确认重置密码" }));

    expect(props.onResetPassword).toHaveBeenCalledWith({
      phone: "13800138000",
      challengeId: "746fb70b-a27e-4a78-a231-aa55ef8c343e",
      code: "123456",
      newPassword: "AnotherStrongPassword9",
    });
    expect(await screen.findByRole("heading", { name: "登录组织空间" })).toBeVisible();
    expect(screen.getByLabelText("手机号")).toHaveValue("13800138000");
  });
});
