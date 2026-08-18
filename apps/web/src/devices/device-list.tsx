import { useState } from "react";

interface DeviceItem {
  id: string;
  name: string;
  current: boolean;
  revokedAt: string | null;
}

interface DeviceListProps {
  items: DeviceItem[];
  busyDeviceId?: string | undefined;
  onRevoke: (deviceId: string) => Promise<void>;
}

export function DeviceList({ items, busyDeviceId, onRevoke }: DeviceListProps) {
  const [candidate, setCandidate] = useState<DeviceItem>();

  async function confirm(): Promise<void> {
    if (candidate === undefined) return;
    await onRevoke(candidate.id);
    setCandidate(undefined);
  }

  return (
    <section className="workspace-card device-card" aria-labelledby="device-title">
      <div className="card-heading">
        <div>
          <p className="section-index">02 / DEVICES</p>
          <h2 id="device-title">登录设备</h2>
        </div>
        <span className="count-mark">{String(items.length).padStart(2, "0")}</span>
      </div>
      <ul className="device-list">
        {items.map((item) => (
          <li key={item.id}>
            <div>
              <strong>{item.name}</strong>
              <span>{item.current ? "本次会话" : item.revokedAt === null ? "可用" : "已撤销"}</span>
            </div>
            {item.current ? (
              <button disabled type="button">
                当前设备不可撤销
              </button>
            ) : (
              <button
                disabled={item.revokedAt !== null || busyDeviceId === item.id}
                type="button"
                onClick={() => setCandidate(item)}
              >
                {busyDeviceId === item.id ? "正在撤销…" : `撤销 ${item.name}`}
              </button>
            )}
          </li>
        ))}
      </ul>

      {candidate === undefined ? null : (
        <div className="dialog-backdrop" role="presentation">
          <section
            aria-labelledby="revoke-title"
            aria-modal="true"
            className="confirm-dialog"
            role="dialog"
          >
            <p className="section-index">DEVICE REVOCATION</p>
            <h3 id="revoke-title">撤销 {candidate.name}？</h3>
            <p>该设备上的全部会话将立即失效，不影响你的其他设备。</p>
            <div className="dialog-actions">
              <button className="text-action" type="button" onClick={() => setCandidate(undefined)}>
                取消
              </button>
              <button className="danger-action" type="button" onClick={() => void confirm()}>
                确认撤销
              </button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
