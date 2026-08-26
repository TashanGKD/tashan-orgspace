import { AlertCircle, Ban, Inbox, RefreshCw } from "lucide-react";

import { Button, Skeleton } from "../../design-system/primitives/index.js";

export type ResourceStateKind =
  | "loading"
  | "empty"
  | "partial-error"
  | "fatal-error"
  | "forbidden"
  | "readonly"
  | "version-conflict";

const copy = {
  loading: (label: string) => `正在加载${label}`,
  empty: (label: string) => `还没有${label}`,
  "partial-error": (label: string) => `部分${label}暂时无法加载`,
  "fatal-error": (label: string) => `${label}加载失败`,
  forbidden: (label: string) => `无权查看${label}`,
  readonly: (label: string) => `${label}当前为只读`,
  "version-conflict": (label: string) => `${label}已被其他人更新`,
} satisfies Record<ResourceStateKind, (label: string) => string>;

export function ResourceState({
  actionLabel = "重试",
  onAction,
  resourceLabel,
  state,
}: {
  actionLabel?: string;
  onAction?(): void;
  resourceLabel: string;
  state: ResourceStateKind;
}) {
  const message = copy[state](resourceLabel);
  if (state === "loading") {
    return (
      <section className="resource-state resource-state--loading" aria-label={message}>
        <p>{message}</p>
        <Skeleton label={message} />
        <Skeleton label={`${message}，第二行`} />
        <Skeleton label={`${message}，第三行`} />
      </section>
    );
  }

  const Icon = state === "empty" ? Inbox : state === "forbidden" ? Ban : AlertCircle;
  const alert = state === "fatal-error" || state === "version-conflict";
  return (
    <section
      className="resource-state"
      data-state={state}
      {...(alert ? { role: "alert" as const } : {})}
    >
      <Icon aria-hidden size={22} />
      <p>{message}</p>
      {onAction ? (
        <Button size="small" variant="secondary" onClick={onAction}>
          <RefreshCw aria-hidden size={14} />
          {actionLabel}
        </Button>
      ) : null}
    </section>
  );
}
