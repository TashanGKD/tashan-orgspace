import clsx from "clsx";
import type { HTMLAttributes } from "react";

export type StatusTone = "neutral" | "success" | "warning" | "error" | "info";

export function StatusBadge({
  children,
  className,
  tone = "neutral",
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: StatusTone }) {
  return (
    <span className={clsx("org-status-badge", className)} data-tone={tone} {...props}>
      {children}
    </span>
  );
}
