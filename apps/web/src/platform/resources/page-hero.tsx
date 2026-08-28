import type { ReactNode } from "react";

export function PageHero({
  action,
  description,
  title,
}: {
  action?: ReactNode;
  description?: string;
  title: string;
}) {
  return (
    <header className="page-hero">
      <div>
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      {action ? <div className="page-hero-action">{action}</div> : null}
    </header>
  );
}
