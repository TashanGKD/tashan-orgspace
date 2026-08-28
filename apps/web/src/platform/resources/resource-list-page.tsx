import type { ReactNode } from "react";

import { PageHero } from "./page-hero.js";

export function ResourceListPage({
  children,
  description,
  primaryAction,
  summary,
  title,
  toolbar,
  view = "list",
}: {
  children: ReactNode;
  description?: string;
  primaryAction?: ReactNode;
  summary?: ReactNode;
  title: string;
  toolbar?: ReactNode;
  view?: "list" | "grid";
}) {
  return (
    <section className="resource-list-page" data-view={view}>
      <PageHero
        title={title}
        {...(description === undefined ? {} : { description })}
        {...(primaryAction === undefined ? {} : { action: primaryAction })}
      />
      {summary ? <div className="resource-summary">{summary}</div> : null}
      {toolbar}
      <div className="resource-list-content">{children}</div>
    </section>
  );
}
