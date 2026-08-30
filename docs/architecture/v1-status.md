# OrgSpace v1 状态

## 当前实现

OrgSpace v1 是独立后端、Web、CLI、Skill 和 Realtime 服务，包含：

- 手机号注册登录、短信验证码重置密码、多设备 token 与审计；
- 个人/组织文件、版本、回收站、MinIO、额度和文件夹角色；
- 组织任务、会议、审批、流程、OKR 与进度/实质修改边界；
- Partner 私有负责人目录、管理员全局视图、跟进与待接管；
- 站内通知、每日汇总、强制提醒、阿里云短信投递状态；
- 组织私聊/群聊、HTTP 历史、WebSocket 实时、附件、@、撤回、合规检查与消息转工作；
- 授权搜索与跨组织 My Work；
- 109 项 API/SDK/CLI/Web/Skill capability 一致性门禁。

## 延期范围

用户代码执行、Docker 构建、常驻服务、数据库产品、用户网站部署、动态用户域名和 AI 员工不属于 v1。四个运行/服务模块只在导航显示“即将上线”，没有 capability、CLI 或 Skill 动作。

## 发布状态

Phase 1–5 已完成本地、隔离生产形态和真实生产验收。AUP 部署提交为 `968ce996c30bdc7cce3675cb34df150391668c86`，公开版本为 `v1.0.2`；真实短信运营商送达、生产浏览器、隧道恢复、文件 TLS、GitHub Release、官方镜像和全新用户 Skill/CLI 安装证据见 `docs/verification/v1-full-product-acceptance.md`。
