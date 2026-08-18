import { useEffect, useRef, useState } from "react";

import { OrgSpaceApiError, type OrgSpaceClient } from "@tashan/sdk";

import { LoginPage } from "./auth/login-page.js";
import { DeviceList } from "./devices/device-list.js";
import { OrganizationSwitcher } from "./organizations/organization-switcher.js";

export interface WebDeviceMetadata {
  id: string;
  name: string;
  os: string;
  architecture: string;
  clientVersion: string;
  channel: "web";
}

interface AccountView {
  username: string;
  phone: string | null;
  phoneVerifiedAt: string | null;
}

interface OrganizationView {
  id: string;
  name: string;
}

interface DeviceView {
  id: string;
  name: string;
  current: boolean;
  revokedAt: string | null;
}

function publicError(error: unknown): string {
  if (error instanceof OrgSpaceApiError) return error.message;
  return "请求没有完成，请稍后重试。";
}

function mutationKey(action: string): string {
  return `web-${action}-${crypto.randomUUID()}`;
}

export function App({ sdk, device }: { sdk: OrgSpaceClient; device: WebDeviceMetadata }) {
  const [account, setAccount] = useState<AccountView>();
  const [organizations, setOrganizations] = useState<OrganizationView[]>([]);
  const [selectedOrganizationId, setSelectedOrganizationId] = useState("");
  const [devices, setDevices] = useState<DeviceView[]>([]);
  const [busy, setBusy] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();
  const [challengeId, setChallengeId] = useState<string>();
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const errorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (error !== undefined) errorRef.current?.focus();
  }, [error]);

  useEffect(() => {
    let active = true;
    setBusy("restore");
    void sdk
      .refresh()
      .then(async () => {
        if (active) await loadWorkspace();
      })
      .catch((caught: unknown) => {
        if (active && (!(caught instanceof OrgSpaceApiError) || caught.code !== "AUTH_REQUIRED")) {
          setError(publicError(caught));
        }
      })
      .finally(() => {
        if (active) setBusy(undefined);
      });
    return () => {
      active = false;
    };
  }, [sdk]);

  function clearFeedback(): void {
    setError(undefined);
    setNotice(undefined);
  }

  async function loadWorkspace(): Promise<void> {
    const [identity, organizationResult, deviceResult] = await Promise.all([
      sdk.whoami(),
      sdk.listOrganizations(),
      sdk.listDevices(),
    ]);
    setAccount(identity.account);
    setOrganizations(organizationResult.items);
    setSelectedOrganizationId((current) => current || organizationResult.items[0]?.id || "");
    setDevices(deviceResult.items);
  }

  async function perform(label: string, action: () => Promise<void>): Promise<void> {
    clearFeedback();
    setBusy(label);
    try {
      await action();
    } catch (caught) {
      setError(publicError(caught));
    } finally {
      setBusy(undefined);
    }
  }

  async function login(username: string, password: string): Promise<void> {
    await perform("login", async () => {
      await sdk.login({ username, password, device });
      await loadWorkspace();
    });
  }

  async function register(username: string, password: string): Promise<void> {
    await perform("register", async () => {
      await sdk.register({ username, password }, { idempotencyKey: mutationKey("register") });
      setNotice("账号已创建，请登录后验证手机号。");
    });
  }

  async function createOrganization(name: string): Promise<void> {
    await perform("create-organization", async () => {
      const created = await sdk.createOrganization(
        { name },
        { idempotencyKey: mutationKey("organization") },
      );
      setOrganizations((current) => [...current, created.organization]);
      setSelectedOrganizationId(created.organization.id);
      setNotice("组织已创建");
    });
  }

  async function revokeDevice(deviceId: string): Promise<void> {
    await perform(`revoke:${deviceId}`, async () => {
      const revoked = await sdk.revokeDevice(deviceId, {
        idempotencyKey: mutationKey("device-revoke"),
      });
      setDevices((current) =>
        current.map((item) =>
          item.id === revoked.deviceId ? { ...item, revokedAt: revoked.revokedAt } : item,
        ),
      );
      setNotice("设备已撤销");
    });
  }

  async function startPhoneVerification(): Promise<void> {
    await perform("phone-start", async () => {
      const result = await sdk.startPhoneVerification(
        { phone },
        { idempotencyKey: mutationKey("phone-start") },
      );
      setChallengeId(result.challengeId);
      setNotice("验证码已发送");
    });
  }

  async function confirmPhoneVerification(): Promise<void> {
    if (challengeId === undefined) return;
    await perform("phone-confirm", async () => {
      const verified = await sdk.confirmPhoneVerification(
        { challengeId, code },
        { idempotencyKey: mutationKey("phone-confirm") },
      );
      setAccount((current) =>
        current === undefined
          ? current
          : { ...current, phone: verified.phone, phoneVerifiedAt: verified.verifiedAt },
      );
      setChallengeId(undefined);
      setCode("");
      setNotice("手机号已验证");
    });
  }

  async function logout(): Promise<void> {
    await perform("logout", async () => {
      await sdk.logout();
      setAccount(undefined);
      setOrganizations([]);
      setDevices([]);
    });
  }

  return (
    <div className="app-frame">
      {error === undefined ? null : (
        <div
          aria-live="assertive"
          className="global-message error-message"
          ref={errorRef}
          role="alert"
          tabIndex={-1}
        >
          {error}
        </div>
      )}
      {notice === undefined ? null : (
        <div aria-live="polite" className="global-message success-message" role="status">
          {notice}
        </div>
      )}

      {account === undefined ? (
        <LoginPage busy={busy !== undefined} onLogin={login} onRegister={register} />
      ) : (
        <>
          <header className="workspace-header">
            <a className="wordmark" href="/" aria-label="他山组织空间首页">
              <span>他山</span>
              <small>ORGSPACE</small>
            </a>
            <div className="member-mark">
              <span className="status-dot" aria-hidden="true" />
              <strong>{account.username}</strong>
              <button
                className="text-action"
                disabled={busy === "logout"}
                type="button"
                onClick={() => void logout()}
              >
                退出
              </button>
            </div>
          </header>

          <main className="workspace-main">
            <section className="workspace-intro">
              <p className="eyebrow">CONTROL DESK / 组织控制台</p>
              <h1>今日工作，从明确边界开始。</h1>
              <p>在这里确认你所在的组织和当前活跃设备。所有重要操作都将进入审计记录。</p>
            </section>

            {account.phoneVerifiedAt === null ? (
              <section className="verification-strip" aria-labelledby="phone-title">
                <div>
                  <p className="section-index">IDENTITY CHECK</p>
                  <h2 id="phone-title">验证手机号</h2>
                  <p>完成验证后才可以创建或加入组织。</p>
                </div>
                {challengeId === undefined ? (
                  <div className="verification-controls">
                    <label>
                      手机号
                      <input
                        value={phone}
                        placeholder="+8613800138000"
                        onChange={(event) => setPhone(event.target.value)}
                      />
                    </label>
                    <button
                      disabled={busy === "phone-start"}
                      type="button"
                      onClick={() => void startPhoneVerification()}
                    >
                      发送验证码
                    </button>
                  </div>
                ) : (
                  <div className="verification-controls">
                    <label>
                      验证码
                      <input
                        inputMode="numeric"
                        value={code}
                        onChange={(event) => setCode(event.target.value)}
                      />
                    </label>
                    <button
                      disabled={busy === "phone-confirm"}
                      type="button"
                      onClick={() => void confirmPhoneVerification()}
                    >
                      确认验证
                    </button>
                  </div>
                )}
              </section>
            ) : null}

            <div className="workspace-grid">
              <OrganizationSwitcher
                busy={busy === "create-organization"}
                items={organizations}
                selectedId={selectedOrganizationId}
                onCreate={createOrganization}
                onSelect={setSelectedOrganizationId}
              />
              <DeviceList
                items={devices}
                busyDeviceId={busy?.startsWith("revoke:") === true ? busy.slice(7) : undefined}
                onRevoke={revokeDevice}
              />
            </div>
          </main>
        </>
      )}
    </div>
  );
}
