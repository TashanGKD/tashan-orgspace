import { useState, type FormEvent } from "react";

interface LoginPageProps {
  busy: boolean;
  onLogin: (username: string, password: string) => Promise<void>;
  onRegister: (username: string, password: string) => Promise<void>;
}

export function LoginPage({ busy, onLogin, onRegister }: LoginPageProps) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (mode === "login") await onLogin(username, password);
    else await onRegister(username, password);
    setPassword("");
  }

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
          一个账号连接你的组织、设备与工作记录。每次操作都在明确的权限边界内发生，并留下可核查的轨迹。
        </p>
        <dl className="access-principles">
          <div>
            <dt>01</dt>
            <dd>真实人员，唯一身份</dd>
          </div>
          <div>
            <dt>02</dt>
            <dd>多台设备，分别撤销</dd>
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
        <h2 id="access-title">{mode === "login" ? "登录组织空间" : "创建个人账号"}</h2>
        <p className="quiet">
          {mode === "login" ? "使用你的平台账号继续。" : "注册后需要验证手机号才能加入或创建组织。"}
        </p>
        <form onSubmit={(event) => void submit(event)}>
          <label>
            用户名
            <input
              autoComplete="username"
              name="username"
              required
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
          </label>
          <label>
            密码
            <input
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              minLength={8}
              name="password"
              required
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <button className="primary-action" disabled={busy} type="submit">
            {busy
              ? mode === "login"
                ? "正在登录…"
                : "正在注册…"
              : mode === "login"
                ? "登录"
                : "注册"}
          </button>
        </form>
        <button
          className="text-action"
          disabled={busy}
          type="button"
          onClick={() => setMode((current) => (current === "login" ? "register" : "login"))}
        >
          {mode === "login" ? "还没有账号？创建账号" : "已有账号？返回登录"}
        </button>
      </section>
    </main>
  );
}
