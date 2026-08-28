import { ExternalLink } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";

import { Sheet, SheetContent, SheetTitle } from "../../design-system/primitives/index.js";

export function ResourceDetailDrawer({
  children,
  detail,
  footer,
  fullPageHref,
  onOpenChange,
  open,
  subtitle,
  technical,
  title,
}: {
  children?: ReactNode;
  detail?: ReactNode;
  footer?: ReactNode;
  fullPageHref?: string;
  onOpenChange(open: boolean): void;
  open: boolean;
  subtitle?: string;
  technical?: ReactNode;
  title: string;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="resource-detail-drawer">
        <header className="resource-detail-drawer-header">
          <div>
            <SheetTitle>{title}</SheetTitle>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          {fullPageHref ? (
            <Link className="resource-full-page-link" to={fullPageHref}>
              打开完整详情
              <ExternalLink aria-hidden size={14} />
            </Link>
          ) : null}
        </header>
        <div className="resource-detail-drawer-body">
          {detail ? <section className="resource-detail-primary">{detail}</section> : null}
          {children}
          {technical ? (
            <section aria-label="技术信息" className="resource-technical-information">
              <h2>技术信息</h2>
              {technical}
            </section>
          ) : null}
        </div>
        {footer ? <footer className="resource-detail-drawer-footer">{footer}</footer> : null}
      </SheetContent>
    </Sheet>
  );
}
