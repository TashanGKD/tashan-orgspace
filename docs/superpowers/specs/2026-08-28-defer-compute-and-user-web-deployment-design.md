# OrgSpace 延期计算执行与用户网站部署设计

> 日期：2026-08-28  
> 状态：用户已批准产品范围调整  
> 评审更新：用户选择保留延期模块导航，并统一标记“即将上线”
> 适用范围：产品总设计、完整交付计划、前端蓝图、模块注册表、CLI/Skill 路线与范围门禁

## 1. 决策

OrgSpace 当前及 v1 不实现面向用户的通用计算执行或网站托管能力。

这不是删除历史讨论，而是明确延期。相关方向继续作为产品路线图保留在导航中，并统一标记“即将上线”；但它们不进入当前实施阶段、CLI 命令、API capability 或 v1 验收目标。

当前产品重新聚焦为：

> 面向组织的协作、文件、任务、OKR、审批、会议、通知、短信与聊天平台。

## 2. 被延期的能力

### 2.1 通用计算执行

当前不做：

- Python、Node.js 和编译型语言远程执行；
- 批处理、定时计算任务和交互式终端；
- 用户 Docker/OCI 镜像构建；
- BuildKit、Executor、运行队列、运行日志、计算产物；
- capped/elastic 计算资源策略；
- 用户计算池、平台计算保留池和应急计算保留池；
- 用户工作负载公网出站、私网阻断和运行时挂载模型。

### 2.2 用户网站与服务托管

当前不做任何一种用户网站部署：

- 静态网站上传与托管；
- 全栈 Web 应用部署；
- 预构建容器运行；
- 用户后端 HTTP 服务；
- 用户数据库产品；
- Agent daemon 或其他常驻进程；
- 用户服务域名、动态路由和登录墙；
- `service public`、匿名访问开关、服务回滚和服务备份。

“可以部署网页”的方向也一并延期，只作为“即将上线”方向保留，不提供真实部署动作。

## 3. 明确保留的能力

### 3.1 OrgSpace 自身部署

范围调整不影响 OrgSpace 自身运行：

- OrgSpace Web 与 API 继续部署在 AUP；
- 用户继续通过 `https://orgspace.tashan.chat` 使用平台；
- ECS TLS/Nginx、AUP 反向隧道和平台 gateway 继续作为平台基础设施；
- PostgreSQL、Redis、Docker Compose 和 Nginx 可继续用于 OrgSpace 自身运维；
- 官方 Skill/CLI HTTPS 分发和 GitHub Release 备用源继续保留。

平台自身使用容器和数据库，不等于向用户提供容器、数据库或网站托管产品。

### 3.2 协作与文件

继续保留并实施：

- 独立账号、手机号、设备 token、组织、成员和审计；
- 个人空间与组织空间；
- 文件上传、下载、读取、版本、搜索、回收站和存储额度；
- WorkItem、Assignment、ProcessDefinition；
- 组织任务、个人待办投影、异议和申请转派；
- OKR、进度更新和实质修改审批；
- 审批、会议和未来制度扩展包；
- 通知中心、阿里云短信、每日汇总和强制提醒；
- 组织群聊、共同组织内私聊、附件和消息转工作；
- 未来 AI 员工所需的 Principal、事件、权限和审计扩展性，但当前不启用 AI 员工。

文件只是协作资料，不作为用户程序的运行目录或网站发布来源。

## 4. 方案比较与选择

### 方案 A：明确延期并从当前范围移除（未选择）

- 从当前总设计、交付阶段、前端模块、CLI/Skill 路线和验收清单中移除；
- 在独立的“延期能力”记录中保存历史背景；
- 未来只有新的用户决策、设计规格和实施计划才能重新进入范围。

优点：当前产品边界清晰，不误导用户，也不丢失历史。缺点：需要系统清理多个文档与注册表引用。

### 方案 B：彻底删除所有历史内容（未选择）

优点：表面最干净。缺点：失去决策沿革，未来无法判断某些安全设计为何存在。

### 方案 C：继续留在导航并标记“即将上线”（已选择）

保留“个人运行与构建”“个人服务与数据库”“运行与构建”“服务与数据库”等方向入口。入口只进入统一的说明页，明确显示“即将上线”和“此功能暂未开放”，不出现创建、部署、运行、公开或数据库操作。

优点：用户可以看见完整产品方向，导航结构未来不需要重新教育。代价：必须用代码和门禁保证“可见入口”不会被误当成“已经实现”。

## 5. 产品与架构影响

### 5.1 产品定义

“协作与安全计算平台”调整为“组织协作与文件平台”。“执行”只表示组织工作流的状态推进，不再表示运行用户程序。

### 5.2 对象模型

当前实现对象集合不包含：

- `RuntimeWorkload`、`RunAttempt`、`Build`、`RuntimeArtifact`；
- `Service`、`DatabaseService`、`Daemon`；
- `ServiceDomain`、`ServiceRoute`、`ServicePublication`。

平台内部部署记录不是用户资源对象，不进入上述产品模型。

### 5.3 前端

当前模块注册表保留：

- `personal.runtime`；
- `personal.services`；
- `organization.runtime`；
- `organization.services`。

这些模块必须同时满足：

- `status` 固定为 `coming_soon`；
- `capabilities` 固定为空数组；
- 路由只渲染统一的 Coming Soon 页面；
- 页面没有表单、执行按钮或网络写操作；
- 主导航不在每一项旁重复堆叠状态噪音，但进入页面后明确显示“即将上线”。

`personal.usage` 当前只规划存储额度与文件用量；未来计算用量不属于 v1 验收。

前端蓝图保留这些模块在信息架构中的位置，但删除具体运行、构建、服务、数据库和域名操作界面，只保留 Coming Soon 状态页。

### 5.4 API、CLI 与 Skill

当前不定义或预留以下用户命令：

- `run`、`build`；
- `service`、`database`；
- 网站发布、域名和 public/private 切换命令。

CLI 全功能覆盖原则保持不变，但“全功能”仅指当前批准的产品能力。延期能力不进入 capability registry，也不允许 Web 单独实现。

### 5.5 基础设施

删除 Go Executor、rootless Docker/BuildKit 用户执行面的当前建设计划。平台现有 Node.js API、Worker、PostgreSQL、Redis、Nginx 和部署 Compose 不受影响。

对象存储仍属于文件系统数据面，不再承担构建产物或运行产物职责。

## 6. 文档迁移规则

实施时按以下方式处理：

1. 当前真源文档直接更新产品定义、范围和阶段。
2. 历史设计或验证记录不伪造为“从未讨论过”；在顶部或相关段落标记已由本决策取代。
3. README、前端蓝图、Web 逻辑设计和完整交付计划必须使用相同范围。
4. 保留模块注册表中的延期入口，但固定为无 capability 的 `coming_soon` 状态。
5. 已实现的 Phase 0、AUP 公网控制面和 Skill/CLI 分发文档不得被误删。

主要受影响真源：

- `README.md`；
- `docs/superpowers/specs/2026-08-18-tashan-orgspace-design.md`；
- `docs/superpowers/specs/2026-08-19-public-control-plane-sequencing.md`；
- `docs/superpowers/specs/2026-08-19-web-logic-and-architecture-design.md`；
- `docs/superpowers/specs/2026-08-26-full-product-frontend-blueprint.md`；
- `docs/superpowers/plans/2026-08-26-full-product-delivery.md`；
- `apps/web/src/product-modules.json`；
- 相关 README、Skill 安全说明和验证边界。

## 7. 防漂移门禁

新增机器可执行范围门禁，不能只靠文档提醒：

- 新建 `deferred-product-scope.json` 作为延期范围真源；
- 新建 `check-deferred-product-scope.mjs` 及同名 self-test；
- 门禁要求延期模块 ID 继续存在，并固定为 `status=coming_soon`、`capabilities=[]`；
- 门禁拒绝 `runtime.*`、`build.*`、`service.*`、`database.*` capability 进入当前注册表；
- 门禁检查延期路由只绑定 Coming Soon 页面，不能出现真实运行、部署或公开动作；
- 门禁检查 README、总设计、前端蓝图和交付计划不把延期能力列为当前实现或 v1 验收范围；
- self-test 分别把模块改为 `available`、注入一个服务 capability 和加入一条当前实现承诺，确认三者都会阻断 CI。

未来重新启用时，必须由新的设计决策显式修改延期范围真源、能力注册表和所有一致性测试。

## 8. 验收标准

范围调整完成的判断条件：

- 当前产品定义不再包含“安全计算”或用户网站托管；
- 当前 v1 范围不再包含代码执行、Docker 构建、服务、数据库、daemon 或用户域名；
- Web 导航保留运行、构建、服务和数据库方向；进入后只能看到“即将上线”状态页；
- 延期入口始终为 `coming_soon` 且不绑定 capability；
- CLI、Skill 和 capability registry 不含对应用户能力；
- 文件与存储用量仍保留，且不出现计算资源表述；
- OrgSpace 自身 AUP 部署、HTTPS 入口、数据库和分发体系保持有效；
- 现有 Phase 0 自动化、生产栈和 E2E 继续通过；
- 延期范围门禁及其负向自测进入完整验证器。

## 9. 非目标

本次只调整产品设计与范围，不实现文件、任务、OKR、通知或聊天，也不删除平台自身部署基础设施。用户网站或通用计算未来是否重新进入范围，不在本次决策中预先设计。
