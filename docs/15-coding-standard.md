# HermesEye · 编码规范 V1.0

建立：2026-10-07。适用范围：`entry/src/main/ets/**`（ArkTS/ArkUI）、`entry/src/test/**`、`entry/src/ohosTest/**`、`backend/**`、`scripts/**`。
效力：**新增与修改代码必须遵守**；存量代码按第 9 节清单分批整改，其中标记为 `error` 的机检项必须一次清零。
配套文档：[16 日志打印规范](16-logging-standard.md)、[03 架构边界](03-architecture.md)、[04 测试计划](testing/04-test-plan.md)。

## 0. 约定与强制等级

| 级别 | 含义 | 机检行为 |
|---|---|---|
| **MUST** | 违反即视为缺陷 | `scripts/check-standards.cjs` 报 `error`，`verify.sh` 直接失败 |
| **SHOULD** | 违反需在评审中说明理由 | 报 `warn`，不阻断流水线，但计入存量告警台账 |
| **MAY** | 建议做法 | 不检查 |

规范之间的优先级：本文件与 [16 日志打印规范](16-logging-standard.md) 冲突时以各自主题为准；与 HarmonyOS 官方 ArkTS 约束冲突时以官方为准；与 `.dsh/skills/harmonyos-arkts` 冲突时以技能为准（技能更贴近 SDK 版本事实）。

一条命令跑完全部门禁：

```bash
node scripts/check-standards.cjs          # 人读报告，有 error 时退出码 1
node scripts/check-standards.cjs --json docs/testing/validation/<日期>-<标签>/standards.json
```
`bash scripts/verify.sh` 已把它作为第一个阶段。

## 1. 分层与依赖方向（MUST）

依赖只能自上而下：`pages/ · components/ → services/ → core/`，反向依赖一律禁止。

| 目录 | 扩展名 | 允许内容 | 禁止 |
|---|---|---|---|
| `entry/src/main/ets/core/` | `.ts` | 实体、校验、迁移、状态与计划规则等**可移植纯规则** | `@ohos.*`/`@kit.*` 导入、`../services`、`../pages`、`../components`、ArkUI 装饰器、`hilog` |
| `entry/src/main/ets/services/` | `.ets` | 文件、网络、Asset Store、日历、通知、提醒、窗口等**平台适配** | ArkUI 组件装饰器、页面状态 |
| `entry/src/main/ets/pages/` `components/` | `.ets` | ArkUI 界面、页面状态、交互编排 | 直接读写文件/Asset Store/HTTP（应经 services） |
| `entryability/` `entrybackupability/` | `.ets` | Ability 生命周期 | 业务规则 |

- `core/` 用 `.ts` 是**硬约束**，不是笔误：`scripts/test-*.cjs` 用 DevEco 自带 TypeScript 在内存里转译 `core/` 并在 Node VM 中执行，没有 ArkTS 运行时；这类文件必须能脱离设备测试。
- 机检：`CS-01`（core 依赖）、`CS-02`（装饰器越界）、`CS-03`（AssetStoreKit 只能出现在 `CredentialStore.ets`）。

## 2. 文件与命名（MUST / SHOULD）

- **MUST** 文件名 PascalCase；一个文件只放一个组件/主类时，文件名与类型名一致（`CS-07`）。多类型规则模块文件（`Domain.ts`、`BusinessSync.ts`、`WorkspaceComponents.ets`）是既有约定，允许文件名不等于其中任一类型。
- **MUST** 类、接口、枚举、`struct` 用 PascalCase；函数与变量 camelCase；模块级常量 UPPER_SNAKE_CASE（如 `LOG_DOMAIN`）。
- **MUST** 布尔语义用 `is/has/can/allow/enable` 前缀；异步方法用动词原形（`save`、`submit`、`synchronize`），返回 Promise 不加 `Async` 后缀。
- **MUST** 标识符一律由 `newId()` 生成（`core/Workspace.ts`）；禁止用数组下标或时间戳当业务 ID。
- **SHOULD** 文件名动词化描述职责：`ConnectionService`、`WorkspaceRepository`、`KeyboardAvoidance`。

## 3. 语言与格式（MUST / SHOULD）

- **MUST** 2 空格缩进、禁止 Tab（`CS-09`）；语句以分号结尾；单引号字符串（`CS-10`，SHOULD）；文件末尾保留一个换行（`CS-11`，SHOULD）。
- **MUST** 禁止 `any` / `unknown`（`CS-04`）。外部数据（HTTP 响应、文件内容、Asset 返回值）先声明 `interface`/`class` 形状再断言。
- **MUST** 禁止 `Function` 类型，写完整签名：`(value: string) => void`（`CS-05`）。
- **MUST** 禁止 `namespace`、`require`、`eval`、原型改写（`CS-06`）；模块只用 `import`/`export`。
- **MUST** 对象字面量必须有明确类型：先定义 `interface`，再 `const x: MyShape = { ... }`；不得使用匿名对象类型。
- **MUST** 类字段必须初始化，或显式可空（`field: Type | null = null`）；`@State` 一律给初值。
- **MUST** 导出的函数签名、服务边界参数与返回值、`catch` 变量都要显式类型（服务边界的类型是协议的一部分）。
- **MUST** 键值集合用 `Map`，不得给类实例加索引签名。
- **SHOULD** 提前返回替代深层嵌套；单个函数超过 60 行时拆分职责。
- **SHOULD** 单行不超过 200 字符（`CS-17`）；ArkUI 链式调用可读时优先换行。
- **SHOULD** 注释解释"为什么"，不重复"做了什么"；中文书写。`TODO` 必须带日期与负责人：`TODO(2026-10-07, 用户名): 说明`（`CS-16`）。

## 4. 错误与失败语义（MUST）

- **MUST** 调用 SDK 中带 `@throws` 标注的 API 必须处于 `try/catch` 中（ArkTS 编译器会对每个调用点报 `Function may throw exceptions`）。按 `BusinessError.code` 分支处理，不要裸吞。
- **MUST** 禁止空 `catch`；`catch` 中必须至少做一件事：转成用户可读错误、记录脱敏日志（见 16）、或重新抛出。
- **MUST** 失败不得静默降级成成功。凭据写入失败必须让保存整体失败，**绝不回退明文存储**；磁盘写入失败不得报告"已保存"。
- **MUST** 平台错误统一经 `services/PlatformErrors.ets`：`platformFailure(operation, error, advice)` 生成用户可读错误，`reportPlatformFailure(operation, error)` 记录错误码。operation 是稳定的操作名常量。
- **MUST** 面向用户的错误文案为中文，且不得包含路径、Token、正文、别名等敏感内容。
- **MUST** 网络请求不自动重试；停止后到达的响应必须丢弃。
- **SHOULD** 错误对象只在抛出层构造一次语义，不要在多层重复包装。

## 5. ArkUI / ArkUI 状态（MUST，本仓库使用状态管理 V1）

- **MUST** `@State` 初始化；`@Link`/`@Prop` 只由父组件传入。
- **MUST** `build()` 单根节点；`if`/`ForEach` 不出现在 `build()` 最外层。
- **MUST** `ForEach` 提供稳定 key（用业务 `id`），禁止用数组下标。
- **MUST** `build()` 内不计算、不拼字符串、不创建对象；提前算好存入字段。
- **MUST** 颜色只用语义色资源 `$r('app.color.xxx')`，且 `resources/base/element/color.json` 与 `resources/dark/element/color.json` 成对登记（`CS-08` 拦截硬编码十六进制）。
- **MUST** 可交互控件提供稳定 `id`（`/^[a-z0-9-]+$/`，如 `main-navigation-2`、`input-项目名称`）；`ohosTest` 的 `UiTest` 与后续模拟点击用例靠它定位。
- **MUST** 面向用户的文案保留中文；新增文案进 `resources/base/element/string.json`，或用 `$r('app.string.xxx')`。
- **SHOULD** 长列表用 `LazyForEach` + `IDataSource`。
- **SHOULD** `stateStyles` 内不要使用 `$r(...)`：历史 jscrash（`TypeError: $r is not callable`，栈顶 `WorkspaceNavigation.ets:22`）指向该模式，尚未定位根因。改动该区域必须设备验证（`CS-12`，见 [10 问题记录](testing/10-test_record.md)）。

## 6. 安全（MUST）

- **MUST** Token 等凭据只进 Asset Store；仅 `services/CredentialStore.ets` 可以 `import { asset } from '@kit.AssetStoreKit'`（`CS-03`）。
- **MUST** 凭据不写入 Preferences/文件/备份/业务同步/日志，不打印别名全文。
- **MUST** 禁止提交真实凭据字面量（`sk-…`、长 `Bearer …`、`password='…'`）——`CS-15`；签名材料与本地配置受 `.gitignore` 保护。
- **MUST** 加密算法下限：哈希 SHA-256 及以上，对称 AES-GCM，非对称 RSA-OAEP/ECDSA 且密钥长度达标；禁用 MD5、SHA-1、DES/3DES、ECB（`code-linter.json5` 的安全规则以 `error` 拦截）。
- **MUST** 默认 HTTPS；仅在显式开关下允许私网/回环/`100.64/10` 的 HTTP。
- **MUST** 上下文分享遵循显式勾选同意；未勾选的数据绝不进入请求。

## 7. 日志（MUST）

日志的 domain/tag 注册表、级别语义、必打点与隐私红线见 **[16 日志打印规范](16-logging-standard.md)**。三条速记：

1. `hilog.<level>(LOG_DOMAIN, LogTag.<Module>, '中文文案', 参数…)`，常量全部来自 `services/Logging.ets`。
2. 占位符必须显式 `%{public}` / `%{private}`，个数等于参数个数。
3. Token、正文、提示词、别名、原始错误对象永不入日志；错误只打错误码。

## 8. 测试规范（MUST）

- **MUST** 改了 `core/`：在对应 Node 套件（`scripts/test-domain.cjs`、`test-workspace.cjs`、`test-business.cjs`）增加行为用例，**成功路径与失败路径都要有**。
- **MUST** 改了 `services/`：在 `scripts/test-services.cjs` 用注入 mock 覆盖失败分支；真实 Asset Store 等只能由 `entry/src/ohosTest` 覆盖。
- **MUST** 新增 `*.test.ets` 必须注册进同目录 `List.test.ets`（`CS-13`）；Hypium 用例必须是 `it('场景描述', 0, async () => {})` 形式（`CS-14`）；禁止 `.only(`。
- **MUST** 交互或导航改动：补 `entry/src/ohosTest` 的模拟点击用例，并在 [10](testing/10-test_record.md)/[05](05-release.md) 记录设备结果。没有设备时只能记录"测试包编译通过"。
- **MUST** 分支覆盖目标见 8.1；覆盖率由 `scripts/coverage.cjs` 生成并纳入 `verify.sh`。
- **MUST** 用例命名描述行为与预期，不写"测试1"；稳定编号（N/S/W/L/U/B/C 系列）只追加不重排。

### 8.1 覆盖率下限

| 范围 | 行/块覆盖下限 | 说明 |
|---|---|---|
| `core/*.ts` | 100% | 纯规则，无平台依赖，必须全分支 |
| `services/*.ets` | ≥ 95% 行、≥ 90% 块 | 注入 mock 覆盖失败路径；真实 SDK 行为另由设备用例覆盖 |
| `scripts/check-standards.cjs` | ≥ 90% | 门禁自身也是被测对象（`scripts/test-standards.cjs`） |

覆盖率不达标时 `verify.sh` 的 `coverage` 阶段失败；确因平台限制无法覆盖的分支，必须在 `docs/testing/04-test-plan.md` 写明"未覆盖分支 + 原因 + 替代验证方式"。

**测量方式**：`node scripts/coverage.cjs`（`--verbose` 列出每个未覆盖分支的源码行，`--json` 出机读报告）。它用 `NODE_V8_COVERAGE` 采集四套 Node 用例里 vm 执行的生产代码，再用 TypeScript source map 把生成行号映射回源码行号。

**已知口径**：V8 的块覆盖会省略"与外层计数相同"的嵌套区间，所以判定必须落在"每个进程各自的未执行集合"上——一个区间只有当**每个执行过该函数的进程**里它都存在且计数为 0 时才算未覆盖。因此 `catch { throw ... }` 之后到 `finally` 之间的空 fall-through 块会永久显示为 0（例如 `BusinessClient.ets:29-30`、`HermesClient.ets:39`），这类区间不影响下限，也不应通过无意义用例去凑。

**2026-10-07 实测**：`core` 470/470 行、371/371 块（100%/100%，`Domain.ts`、`Workspace.ts`、`BusinessSync.ts` 全 100%）；`services` 聚合 99.6% 行 / 99.3% 块（下限 95%/90%），仅上述两处 V8 空块未达 100%；门禁脚本 `scripts/check-standards.cjs` 96.6% 行 / 92.9% 块（下限 90%/90%）。

## 9. 评审与提交检查清单

提交前逐项确认（`node scripts/check-standards.cjs` 全绿是底线，不替代人工判断）：

- [ ] 新增代码不在错误的层；`core/` 仍无平台导入。
- [ ] 所有 `@throws` 调用点都在 `try/catch` 内，且按错误码分支。
- [ ] 没有把失败降级成成功；凭据失败没有回退明文。
- [ ] 新的用户可见文案是中文，颜色走语义色资源，控件有稳定 `id`。
- [ ] 所有 `hilog` 调用使用 `LOG_DOMAIN` + 已注册 `LogTag`，占位符个数与参数一致，无敏感参数。
- [ ] 新增/修改行为都有对应用例，失败路径已覆盖；`bash scripts/verify.sh` 通过。
- [ ] 涉及界面/交互时，已同步 [09 前端设计](09-frontend-design-V1.0.md) 与交互稿。
- [ ] 提交信息用约定前缀（`feat:` / `fix:` / `test:` / `docs:` / `chore:`），主体用祈使句。

## 10. 存量告警台账（不阻断流水线）

当前 `error` 为 0；以下 `warn` 为已登记存量，新增同类告警必须在评审中说明：

| 规则 | 位置 | 处置 |
|---|---|---|
| CS-12 | `WorkspaceNavigation.ets:21`、`WorkspaceComponents.ets:32`、`Index.ets:441` | 保持现状，改动 `stateStyles` 时必须设备回归；排期核实 $r 失效根因 |
| CS-17 | `core/Workspace.ts:221`、`pages/Index.ets` 等 9 处超 200 字符 | 随相关改动顺手拆分 |
| CS-07 | `components/WorkspaceNavigation.ets`（文件声明 `WorkspaceNavigationItem`） | 改名或拆分文件时一并处理 |

台账更新规则：整改完成即从表中删除；确认为误报则在 `check-standards.cjs` 调整规则并在此记录原因与日期。
