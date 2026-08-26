# OrgSpace User-facing Copy Design

Date: 2026-08-26

Status: approved direction; written specification awaiting final review

## Goal

OrgSpace is a product used by organization members and administrators. Its interface should tell users what they can see or do, not explain the platform architecture behind the interface.

The approved reference sentence is:

> 查看和添加组织成员

## Reference pattern

Follow the product-language pattern used by Feishu administration surfaces:

- navigation and page titles use short nouns;
- primary actions use verb-object labels;
- page descriptions use one short functional sentence when needed;
- confirmations explain consequences only for risky actions;
- implementation terms, governance theory and architecture explanations stay out of the interface.

OrgSpace will not copy Feishu wording mechanically. It will use the same level of directness for OrgSpace functions.

## Voice rules

### Page titles

Use a familiar object or area name:

- `组织首页`
- `成员与角色`
- `账号与设备`
- `操作记录`

Do not put implementation stages, English project labels or architecture terms in titles.

### Page descriptions

Use one action-oriented sentence, normally no more than 12 Chinese characters:

- `查看和创建组织`
- `查看和添加组织成员`
- `查看和管理登录设备`
- `查看组织操作记录`

Do not use:

- 资源视图、能力、产品边界、服务器操作；
- Phase 0、统一管理、默认透明；
- 真实人员身份、明确边界、同一工作台；
- “相当于”“本质上”“用于实现”等 explanatory prose.

### Buttons and controls

Use the action and its object:

- `创建组织`
- `添加成员`
- `撤销设备`
- `加载更多`
- `保存`
- `取消`

Do not repeat permission or architecture explanations on the button.

### Empty, loading and error states

Keep the existing direct pattern:

- `正在加载成员`
- `还没有成员`
- `成员加载失败`
- `你没有权限查看此页面`

When recovery is possible, add a clear action such as `重试` or `返回成员列表`.

### Risk confirmations

Risky actions may use one additional consequence sentence:

- Title: `撤销“MacBook Air”？`
- Consequence: `撤销后，这台设备需要重新登录。`
- Actions: `取消` / `确认撤销`

Avoid system-oriented explanations such as “全部旧设备会话将立即失效” unless that technical precision is required for the decision.

## Page rewrite map

| Surface | Current direction to remove | User-facing copy |
|---|---|---|
| Login | 真实人员、唯一身份、组织边界 | `手机号登录` / `管理登录设备` / `加入多个组织` |
| Login heading | 组织的工作，应当有清晰的归属 | `他山组织空间` |
| Login description | architecture manifesto | `登录后查看你加入的组织` |
| Organization list | 从同一组织工作台进入…… | `查看和创建组织` |
| Member list | 默认透明、资源视图 | `查看和添加组织成员` |
| Device list | 真实人员、独立设备会话 | `查看和管理登录设备` |
| Audit list | 设备、客户端执行能力 | `查看组织操作记录` |
| Coming soon | 仅展示产品边界，不执行服务器操作 | `此功能暂未开放` |
| Forbidden organization | 无法访问该组织 | `你没有权限查看此组织` |

## Audit presentation

Audit data needs technical precision, but technical identifiers should not be the main interface language.

### Human-readable event names

| Capability ID | Display name |
|---|---|
| `system.health.read` | 系统健康检查 |
| `capability.list` | 查看可用功能 |
| `capability.describe` | 查看功能说明 |
| `auth.verification.send` | 发送验证码 |
| `auth.password.reset` | 重置密码 |
| `auth.register` | 创建账号 |
| `auth.login` | 登录 |
| `auth.refresh` | 更新登录状态 |
| `auth.logout` | 退出登录 |
| `auth.whoami` | 查看当前账号 |
| `device.list` | 查看登录设备 |
| `device.revoke` | 撤销设备 |
| `organization.list` | 查看组织 |
| `organization.create` | 创建组织 |
| `organization.member.list` | 查看组织成员 |
| `organization.member.add` | 添加组织成员 |
| `audit.list` | 查看操作记录 |

Unknown future IDs may fall back to their raw value so evidence is never hidden.

### Source labels

- `web` → `网页`
- `cli` → `CLI`
- `ai_via_cli` → `AI（通过 CLI）`
- `system` → `系统`

Request ID, object ID, IP, architecture and client version remain available in detail pages because administrators may need them for troubleshooting. They should not dominate list rows.

## Information density

List pages should show the information needed to recognize and choose an item:

- organization: name and status;
- member: name, role and status;
- device: name, operating system, last active time and status;
- audit event: human-readable action, source, time and result.

UUIDs, request IDs, client versions and architecture belong in details, not primary list text.

## Scope and boundaries

This copy pass changes Web user-facing language and the presentation mapping for audit events. It does not rename API capabilities, CLI commands, database fields, audit evidence or Skill contracts.

Automated tests may continue to reference stable technical IDs where they verify contracts. Browser assertions should verify the corresponding user-facing labels.

## Acceptance

- No visible page description contains `资源视图`, `产品边界`, `Phase 0`, or `执行服务器操作`.
- Core descriptions use the approved direct form.
- Audit lists and headings use human-readable actions; raw IDs remain available where evidence requires them.
- Internal UUIDs are removed from ordinary list rows.
- Risk confirmations explain the user consequence and support keyboard interaction.
- Desktop and mobile screenshots are reviewed after the copy pass.
