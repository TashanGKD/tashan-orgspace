import type { ReactNode } from "react";

export function ResourceListPage({
  children,
  description,
  primaryAction,
  summary,
  title,
  toolbar,
}: {
  children: ReactNode;
  description?: string;
  primaryAction?: ReactNode;
  summary?: ReactNode;
  title: string;
  toolbar?: ReactNode;
}) {
  return (
    <section className="resource-list-page">
      <header className="resource-page-heading">
        <div>
          <h1>{title}</h1>
          {description ? <p>{description}</p> : null}
        </div>
        {primaryAction ? <div>{primaryAction}</div> : null}
      </header>
      {summary ? <div className="resource-summary">{summary}</div> : null}
      {toolbar}
      <div className="resource-list-content">{children}</div>
    </section>
  );
}
