import { Link } from "react-router";

import type { ProductModule } from "../../platform/modules/module-catalog.js";
import { pageCopy } from "../../content/user-facing-copy.js";
import { StatusBadge } from "../../design-system/primitives/index.js";
import { PageHero } from "../../platform/resources/page-hero.js";

export function ComingSoonPage({ module, backTo }: { module: ProductModule; backTo: string }) {
  return (
    <article className="roadmap-page">
      <PageHero description={module.description} title={module.label} />
      <section className="roadmap-state">
        <StatusBadge tone="info">即将上线</StatusBadge>
        <p>{pageCopy.comingSoon}</p>
        <Link to={backTo}>返回组织首页</Link>
      </section>
    </article>
  );
}
