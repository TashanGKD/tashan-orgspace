import { Link } from "react-router";

import type { ProductModule } from "../../platform/modules/module-catalog.js";

export function ComingSoonPage({ module, backTo }: { module: ProductModule; backTo: string }) {
  return (
    <article className="roadmap-page">
      <p className="eyebrow">PRODUCT ROADMAP</p>
      <h1>{module.label}</h1>
      <strong className="status-badge">即将上线</strong>
      <p>{module.description}</p>
      <p>该模块目前仅展示产品边界，不提供表单，也不会执行任何服务器操作。</p>
      <Link to={backTo}>返回组织首页</Link>
    </article>
  );
}
