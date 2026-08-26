import { ExternalLink } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";

import { Sheet, SheetContent, SheetTitle } from "../../design-system/primitives/index.js";

export function ResourceDetailDrawer({
  children,
  footer,
  fullPageHref,
  onOpenChange,
  open,
  subtitle,
  title,
}: {
  children: ReactNode;
  footer?: ReactNode;
  fullPageHref: string;
  onOpenChange(open: boolean): void;
  open: boolean;
  subtitle?: string;
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
          <Link className="resource-full-page-link" to={fullPageHref}>
            打开完整详情
            <ExternalLink aria-hidden size={14} />
          </Link>
        </header>
        <div className="resource-detail-drawer-body">{children}</div>
        {footer ? <footer className="resource-detail-drawer-footer">{footer}</footer> : null}
      </SheetContent>
    </Sheet>
  );
}
