import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link } from "react-router";

import type { OrgSpaceClient } from "@tashan/sdk";

import { DeviceList } from "../../devices/device-list.js";
import { useFeedback } from "../../platform/feedback/feedback-context.js";
import { useSession } from "../../platform/session/session-context.js";

function mutationKey(): string {
  return `web-device-revoke-${crypto.randomUUID()}`;
}

export function AccountPage({ sdk }: { sdk: OrgSpaceClient }) {
  const session = useSession();
  const feedback = useFeedback();
  const queryClient = useQueryClient();
  const [phone, setPhone] = useState("");
  const [challengeId, setChallengeId] = useState<string>();
  const [code, setCode] = useState("");
  const [phoneBusy, setPhoneBusy] = useState(false);
  const devices = useQuery({
    queryKey: ["devices"],
    queryFn: ({ signal }) => sdk.listDevices(signal),
  });
  const revoke = useMutation({
    mutationFn: (deviceId: string) => sdk.revokeDevice(deviceId, { idempotencyKey: mutationKey() }),
    onSuccess: async () => {
      feedback.showNotice("设备已撤销");
      await queryClient.invalidateQueries({ queryKey: ["devices"] });
    },
    onError: feedback.showError,
  });

  if (session.status !== "authenticated") return null;

  async function startPhone(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    feedback.clear();
    setPhoneBusy(true);
    try {
      const result = await session.startPhoneVerification(phone);
      setChallengeId(result.challengeId);
      feedback.showNotice("验证码已发送");
    } catch (error) {
      feedback.showError(error);
    } finally {
      setPhoneBusy(false);
    }
  }

  async function confirmPhone(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (challengeId === undefined) return;
    feedback.clear();
    setPhoneBusy(true);
    try {
      await session.confirmPhoneVerification(challengeId, code);
      setChallengeId(undefined);
      setCode("");
      feedback.showNotice("手机号已验证");
    } catch (error) {
      feedback.showError(error);
    } finally {
      setPhoneBusy(false);
    }
  }

  return (
    <main className="workspace-main">
      <Link to="/">返回组织空间</Link>
      <section className="workspace-intro">
        <p className="eyebrow">ACCOUNT CONTROL</p>
        <h1>账号与设备</h1>
        <p>管理真实人员身份、手机号和登录设备。</p>
      </section>

      {session.account.phoneVerifiedAt === null ? (
        <section className="verification-strip" aria-labelledby="phone-title">
          <div>
            <p className="section-index">IDENTITY CHECK</p>
            <h2 id="phone-title">验证手机号</h2>
          </div>
          {challengeId === undefined ? (
            <form className="verification-controls" onSubmit={(event) => void startPhone(event)}>
              <label>
                手机号
                <input required value={phone} onChange={(event) => setPhone(event.target.value)} />
              </label>
              <button disabled={phoneBusy} type="submit">
                发送验证码
              </button>
            </form>
          ) : (
            <form className="verification-controls" onSubmit={(event) => void confirmPhone(event)}>
              <label>
                验证码
                <input required value={code} onChange={(event) => setCode(event.target.value)} />
              </label>
              <button disabled={phoneBusy} type="submit">
                确认验证
              </button>
            </form>
          )}
        </section>
      ) : null}

      {devices.isPending ? <p>正在加载设备…</p> : null}
      {devices.isError ? <p role="alert">设备列表加载失败。</p> : null}
      {devices.data === undefined ? null : (
        <DeviceList
          busyDeviceId={revoke.isPending ? revoke.variables : undefined}
          items={devices.data.items}
          onRevoke={async (deviceId) => {
            await revoke.mutateAsync(deviceId);
          }}
        />
      )}
    </main>
  );
}
