import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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

  return (
    <main className="workspace-main">
      <Link to="/">返回组织空间</Link>
      <section className="workspace-intro">
        <p className="eyebrow">ACCOUNT CONTROL</p>
        <h1>账号与设备</h1>
        <p>管理真实人员身份、手机号和登录设备。</p>
      </section>

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
