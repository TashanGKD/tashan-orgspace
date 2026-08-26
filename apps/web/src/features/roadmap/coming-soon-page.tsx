import { Link } from "react-router";

import type { ProductModule } from "../../platform/modules/module-catalog.js";
import { pageCopy } from "../../content/user-facing-copy.js";

export function ComingSoonPage({ module, backTo }: { module: ProductModule; backTo: string }) {
  return (
    <article className="roadmap-page">
      <h1>{module.label}</h1>
      <strong className="status-badge">即将上线</strong>
      <p>{module.description}</p>
      <p>{pageCopy.comingSoon}</p>
      <Link to={backTo}>返回组织首页</Link>
    </article>
  );
}
