import type { ReactNode } from "react";

export function ResourceDetailPage({
  actions,
  activity,
  attachments,
  children,
  eyebrow,
  relationships,
  subtitle,
  title,
}: {
  actions?: ReactNode;
  activity?: ReactNode;
  attachments?: ReactNode;
  children: ReactNode;
  eyebrow?: string;
  relationships?: ReactNode;
  subtitle?: string;
  title: string;
}) {
  return (
    <article className="resource-detail-page">
      <header className="resource-detail-header">
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h1>{title}</h1>
        {subtitle ? <p>{subtitle}</p> : null}
      </header>
      <div className="resource-detail-content">
        <section aria-label="基础信息">{children}</section>
        {relationships ? <section aria-label="关联事项">{relationships}</section> : null}
        {attachments ? <section aria-label="相关文件">{attachments}</section> : null}
        {activity ? <section aria-label="活动记录">{activity}</section> : null}
      </div>
      {actions ? <footer className="resource-detail-actions">{actions}</footer> : null}
    </article>
  );
}
