import clsx from "clsx";
import type { HTMLAttributes } from "react";

export function Skeleton({
  className,
  label,
  ...props
}: HTMLAttributes<HTMLDivElement> & { label: string }) {
  return (
    <div aria-label={label} className={clsx("org-skeleton", className)} role="status" {...props} />
  );
}
