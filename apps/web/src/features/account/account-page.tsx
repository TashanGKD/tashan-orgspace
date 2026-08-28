import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Laptop, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";

import type { DeviceSummary } from "@tashan/contracts";
import type { OrgSpaceClient } from "@tashan/sdk";

import { pageCopy } from "../../content/user-facing-copy.js";
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
} from "../../design-system/primitives/index.js";
import { ResourceActionBar } from "../../platform/resources/resource-action-bar.js";
import { ResourceDetailDrawer } from "../../platform/resources/resource-detail-drawer.js";
import { ResourceListPage } from "../../platform/resources/resource-list-page.js";
import { ResourceRow } from "../../platform/resources/resource-row.js";
import { ResourceState } from "../../platform/resources/resource-states.js";
import { routes } from "../../platform/routing/route-paths.js";
import { useFeedback } from "../../platform/feedback/feedback-context.js";
import { useSession } from "../../platform/session/session-context.js";

function mutationKey(): string {
  return `web-device-revoke-${crypto.randomUUID()}`;
}

function deviceStatus(device: DeviceSummary) {
  if (device.current) return { label: "本次会话", tone: "info" as const };
  if (device.revokedAt !== null) return { label: "已撤销", tone: "error" as const };
  return { label: "可用", tone: "success" as const };
}

function DeviceDetail({ device }: { device: DeviceSummary }) {
  return (
    <dl className="resource-definition-list">
      <div>
        <dt>状态</dt>
        <dd>{deviceStatus(device).label}</dd>
      </div>
      <div>
        <dt>操作系统</dt>
        <dd>{device.os}</dd>
      </div>
      <div>
        <dt>最近在线</dt>
        <dd>{device.lastSeenAt}</dd>
      </div>
    </dl>
  );
}

export function AccountPage({
  sdk,
  selectedDeviceId,
}: {
  sdk: OrgSpaceClient;
  selectedDeviceId?: string | undefined;
}) {
  const navigate = useNavigate();
  const session = useSession();
  const feedback = useFeedback();
  const queryClient = useQueryClient();
  const [candidate, setCandidate] = useState<DeviceSummary>();
  const devices = useQuery({
    queryKey: ["devices"],
    queryFn: ({ signal }) => sdk.listDevices(signal),
  });
  const revoke = useMutation({
    mutationFn: (deviceId: string) => sdk.revokeDevice(deviceId, { idempotencyKey: mutationKey() }),
    onSuccess: async () => {
      setCandidate(undefined);
      feedback.showNotice("设备已撤销");
      await queryClient.invalidateQueries({ queryKey: ["devices"] });
    },
    onError: feedback.showError,
  });
  const selectedDevice = devices.data?.items.find((device) => device.id === selectedDeviceId);

  if (session.status !== "authenticated") return null;

  return (
    <section className="standalone-resource-page">
      <ResourceListPage description={pageCopy.devices.description} title="账号与设备">
        {devices.isPending ? <ResourceState resourceLabel="设备" state="loading" /> : null}
        {devices.isError ? <ResourceState resourceLabel="设备" state="fatal-error" /> : null}
        {!devices.isPending && !devices.isError && devices.data.items.length === 0 ? (
          <ResourceState resourceLabel="设备" state="empty" />
        ) : null}
        {devices.data?.items.map((device) => (
          <div className="device-resource-item" key={device.id}>
            <ResourceRow
              href={routes.device(device.id)}
              leading={
                device.current ? (
                  <ShieldCheck aria-hidden size={17} />
                ) : (
                  <Laptop aria-hidden size={17} />
                )
              }
              metadata={[device.os, device.lastSeenAt]}
              status={deviceStatus(device)}
              title={device.name}
            />
            {device.current ? (
              <Button disabled size="small" variant="quiet">
                当前设备不可撤销
              </Button>
            ) : (
              <Button
                disabled={
                  device.revokedAt !== null || (revoke.isPending && revoke.variables === device.id)
                }
                size="small"
                variant="danger"
                onClick={() => setCandidate(device)}
              >
                {revoke.isPending && revoke.variables === device.id
                  ? "正在撤销…"
                  : `撤销 ${device.name}`}
              </Button>
            )}
          </div>
        ))}
      </ResourceListPage>
      <ResourceDetailDrawer
        detail={
          selectedDevice ? (
            <DeviceDetail device={selectedDevice} />
          ) : selectedDeviceId && !devices.isPending ? (
            <ResourceState resourceLabel="设备" state="fatal-error" />
          ) : (
            <ResourceState resourceLabel="设备" state="loading" />
          )
        }
        footer={
          selectedDevice ? (
            <ResourceActionBar
              actions={[
                {
                  id: "device.revoke",
                  label: revoke.isPending
                    ? "正在撤销…"
                    : selectedDevice.current
                      ? "当前设备不可撤销"
                      : "撤销设备",
                  onAction: () => setCandidate(selectedDevice),
                  tone: "danger",
                },
              ]}
              mode={
                selectedDevice.current || selectedDevice.revokedAt !== null || revoke.isPending
                  ? "readonly"
                  : "ready"
              }
            />
          ) : null
        }
        onOpenChange={(open) => {
          if (!open) navigate(routes.account);
        }}
        open={selectedDeviceId !== undefined}
        technical={
          selectedDevice ? (
            <dl className="resource-definition-list">
              <div>
                <dt>设备 ID</dt>
                <dd className="tabular-nums">{selectedDevice.id}</dd>
              </div>
              <div>
                <dt>架构</dt>
                <dd>{selectedDevice.architecture}</dd>
              </div>
              <div>
                <dt>客户端版本</dt>
                <dd>{selectedDevice.clientVersion}</dd>
              </div>
            </dl>
          ) : null
        }
        title={selectedDevice?.name ?? "设备信息"}
        {...(selectedDevice ? { subtitle: deviceStatus(selectedDevice).label } : {})}
      />
      <RevokeConfirmation
        candidate={candidate}
        onCancel={() => setCandidate(undefined)}
        onConfirm={() => {
          if (candidate) revoke.mutate(candidate.id);
        }}
      />
    </section>
  );
}

function RevokeConfirmation({
  candidate,
  onCancel,
  onConfirm,
}: {
  candidate?: DeviceSummary | undefined;
  onCancel(): void;
  onConfirm(): void;
}) {
  return candidate === undefined ? null : (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="confirm-dialog">
        <DialogTitle>撤销 {candidate.name}？</DialogTitle>
        <p>{pageCopy.devices.revokeConsequence}</p>
        <div className="dialog-actions">
          <DialogClose asChild>
            <Button variant="quiet">取消</Button>
          </DialogClose>
          <Button variant="danger" onClick={onConfirm}>
            确认撤销
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
