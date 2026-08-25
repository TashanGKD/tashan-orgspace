import { useEffect, useState, type FormEvent } from "react";

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
  login: { title: "登录组织空间", note: "使用手机号和密码，以你的真实身份继续。" },
  register: { title: "创建个人账号", note: "验证手机号后立即建立当前设备会话。" },
  password_reset: { title: "重置账号密码", note: "完成后所有旧设备会话都会失效。" },
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
        <p className="eyebrow">TASHAN · ORGANIZATION OS</p>
        <h1 id="product-title">
          组织的工作，
          <br />
          应当有清晰的归属。
        </h1>
        <p className="manifesto-copy">
          一个手机号对应一个真实成员。每台设备分别建立会话，每次操作都在明确的个人或组织边界内发生。
        </p>
        <dl className="access-principles">
          <div>
            <dt>01</dt>
            <dd>真实人员，唯一身份</dd>
          </div>
          <div>
            <dt>02</dt>
            <dd>多台设备，分别记录</dd>
          </div>
          <div>
            <dt>03</dt>
            <dd>组织边界，默认私密</dd>
          </div>
        </dl>
      </section>

      <section className="access-panel" aria-labelledby="access-title">
        <div className="seal" aria-hidden="true">
          他山
        </div>
        <p className="section-index">成员入口 / MEMBER ACCESS</p>
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
