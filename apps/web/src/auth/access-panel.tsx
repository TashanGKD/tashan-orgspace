import { useEffect, useState, type FormEvent } from "react";

import { pageCopy } from "../content/user-facing-copy.js";

type Mode = "login" | "register" | "password_reset";

interface VerificationResult {
  challengeId: string;
  expiresAt: string;
}

interface AccessPanelProps {
  busy: boolean;
  onLogin(phone: string, password: string): Promise<void>;
  onSendVerificationCode(
    phone: string,
    purpose: "register" | "password_reset",
  ): Promise<VerificationResult>;
  onRegister(input: {
    phone: string;
    challengeId: string;
    code: string;
    password: string;
  }): Promise<void>;
  onResetPassword(input: {
    phone: string;
    challengeId: string;
    code: string;
    newPassword: string;
  }): Promise<void>;
}

const modeCopy = {
  login: { title: "登录", note: "使用手机号和密码登录" },
  register: { title: "创建账号", note: "使用手机号创建账号" },
  password_reset: { title: "重置密码", note: "重置后，其他设备需要重新登录" },
} as const;

export function AccessPanel({
  busy,
  onLogin,
  onRegister,
  onResetPassword,
  onSendVerificationCode,
}: AccessPanelProps) {
  const [mode, setMode] = useState<Mode>("login");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [challengeId, setChallengeId] = useState<string>();
  const [countdown, setCountdown] = useState(0);

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = window.setTimeout(() => setCountdown((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [countdown]);

  function switchMode(next: Mode): void {
    setMode(next);
    setPassword("");
    setCode("");
    setChallengeId(undefined);
    setCountdown(0);
  }

  async function sendCode(): Promise<void> {
    if (mode === "login") return;
    const result = await onSendVerificationCode(phone, mode);
    setChallengeId(result.challengeId);
    setCountdown(60);
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (mode === "login") {
      await onLogin(phone, password);
      setPassword("");
      return;
    }
    if (challengeId === undefined) return;
    if (mode === "register") {
      await onRegister({ phone, challengeId, code, password });
      setPassword("");
      setCode("");
      return;
    }
    await onResetPassword({ phone, challengeId, code, newPassword: password });
    switchMode("login");
  }

  const copy = modeCopy[mode];
  return (
    <main className="access-layout">
      <section className="access-manifesto" aria-labelledby="product-title">
        <h1 id="product-title">{pageCopy.login.heading}</h1>
        <p className="manifesto-copy">{pageCopy.login.description}</p>
        <dl className="access-principles">
          {pageCopy.login.principles.map((principle, index) => (
            <div key={principle}>
              <dt>{String(index + 1).padStart(2, "0")}</dt>
              <dd>{principle}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="access-panel" aria-labelledby="access-title">
        <div className="seal" aria-hidden="true">
          他山
        </div>
        <nav className="access-mode-tabs" aria-label="账号入口" role="tablist">
          <button
            aria-selected={mode === "login"}
            role="tab"
            type="button"
            onClick={() => switchMode("login")}
          >
            登录
          </button>
          <button
            aria-selected={mode === "register"}
            role="tab"
            type="button"
            onClick={() => switchMode("register")}
          >
            创建账号
          </button>
          <button
            aria-selected={mode === "password_reset"}
            role="tab"
            type="button"
            onClick={() => switchMode("password_reset")}
          >
            重置密码
          </button>
        </nav>
        <h2 id="access-title">{copy.title}</h2>
        <p className="quiet">{copy.note}</p>

        <form className="access-form" onSubmit={(event) => void submit(event)}>
          <label>
            手机号
            <input
              autoComplete="tel"
              inputMode="tel"
              name="phone"
              required
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
            />
          </label>

          {mode === "login" ? null : (
            <label>
              验证码
              <span className="verification-code-row">
                <input
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  maxLength={6}
                  name="code"
                  required
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                />
                <button
                  className="secondary-action"
                  disabled={busy || countdown > 0 || phone.length === 0}
                  type="button"
                  onClick={() => void sendCode()}
                >
                  {countdown > 0 ? `${countdown} 秒后可重发` : "发送验证码"}
                </button>
              </span>
            </label>
          )}

          <label>
            {mode === "register" ? "设置密码" : mode === "password_reset" ? "新密码" : "密码"}
            <input
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              minLength={12}
              name="password"
              required
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <button className="primary-action" disabled={busy} type="submit">
            {busy
              ? "正在处理…"
              : mode === "login"
                ? "登录"
                : mode === "register"
                  ? "注册并进入空间"
                  : "确认重置密码"}
          </button>
        </form>
      </section>
    </main>
  );
}
