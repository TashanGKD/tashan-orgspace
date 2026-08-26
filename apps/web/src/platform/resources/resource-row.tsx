import clsx from "clsx";
import type { ReactNode } from "react";
import { Link } from "react-router";

import { StatusBadge, type StatusTone } from "../../design-system/primitives/index.js";

export type ResourceRowStatus = Readonly<{ label: string; tone: StatusTone }>;

function RowContent({
  leading,
  metadata,
  status,
  title,
  trailing,
}: {
  leading?: ReactNode;
  metadata: readonly string[];
  status: ResourceRowStatus;
  title: string;
  trailing?: ReactNode;
}) {
  return (
    <>
      <span aria-hidden className="resource-row-rail" data-tone={status.tone} />
      {leading ? <span className="resource-row-leading">{leading}</span> : null}
      <span className="resource-row-copy">
        <strong>{title}</strong>
        {metadata.length > 0 ? (
          <span className="resource-row-metadata">
            {metadata.map((item) => (
              <span key={item}>{item}</span>
            ))}
          </span>
        ) : null}
      </span>
      <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
      {trailing ? <span className="resource-row-trailing">{trailing}</span> : null}
    </>
  );
}

export function ResourceRow({
  className,
  href,
  leading,
  metadata,
  status,
  title,
  trailing,
}: {
  className?: string;
  href?: string;
  leading?: ReactNode;
  metadata: readonly string[];
  status: ResourceRowStatus;
  title: string;
  trailing?: ReactNode;
}) {
  const content = (
    <RowContent
      leading={leading}
      metadata={metadata}
      status={status}
      title={title}
      trailing={trailing}
    />
  );
  const classes = clsx("resource-row", className);
  return href ? (
    <Link aria-label={`${title} ${status.label}`} className={classes} to={href}>
      {content}
    </Link>
  ) : (
    <article className={classes}>{content}</article>
  );
}
