# HermesEye · 日志打印规范 V1.0

建立：2026-10-07。适用：ArkTS 端 `hilog`（`entry/src/main/ets/**`）与 Python 端 `logging`（`backend/**`）。
配套：[15 编码规范](15-coding-standard.md)（第 7 节引用本文件）、[04 测试计划](testing/04-test-plan.md)（日志排查路径）、`.dsh/skills/harmonyos-harness`（设备侧抓取方式）。
机检：`node scripts/check-standards.cjs`，规则前缀 `LOG-*`（ArkTS）与 `PY-*`（Python）。

## 0. 目标与原则

1. **可检索**：看到一条日志就能判断是哪个模块、什么阶段、成功还是失败。
2. **可隔离**：域（domain）与标签（tag）唯一，能用 `hilog -T` 精确过滤本应用本模块。
3. **不泄密**：日志不是业务数据存储；Token、用户正文、别名、路径永不入日志。
4. **不淹没**：只在状态变化与失败边界记录，不在渲染、循环、高频回调里刷日志。
5. **不重复**：同一个失败只在一个层级记录，避免一次错误刷三行。

## 1. 域（domain）与标签（tag）注册表（MUST）

全应用只有一个域。**禁止**使用 DevEco 模板默认的 `0x0000` 与 `testTag`：该组合过于通用，`-D 0x0000`、`-T testTag` 无法把本应用与其他模板工程区分开（见 [04](testing/04-test-plan.md) 日志排查一节与 `harmonyos-harness` 技能）。

```ts
// entry/src/main/ets/services/Logging.ets —— 唯一权威来源
export const LOG_DOMAIN: number = 0x1200;
export class LogTag {
  static readonly Ability: string = 'Ability';
  static readonly Backup: string = 'Backup';
  static readonly Workspace: string = 'Workspace';
  static readonly Connection: string = 'Connection';
  static readonly Credential: string = 'Credential';
  static readonly Chat: string = 'Chat';
  static readonly Calendar: string = 'Calendar';
  static readonly Reminder: string = 'Reminder';
  static readonly Keyboard: string = 'Keyboard';
  static readonly Presentation: string = 'Presentation';
  static readonly Business: string = 'Business';
  static readonly Platform: string = 'Platform';
  static readonly UI: string = 'UI';
}
```

| Tag | 归属模块 | 记录什么 |
|---|---|---|
| `Ability` | `entryability/EntryAbility.ets` | 生命周期、首页加载成败（含错误码） |
| `Backup` | `entrybackupability/EntryBackupAbility.ets` | 备份/恢复回调结果、备份版本号 |
| `Workspace` | `services/WorkspaceRepository.ets` | 工作区读取/校验/原子替换结果 |
| `Connection` | `services/ConnectionService.ets` | 连接保存、旧凭据清理结果 |
| `Credential` | `services/CredentialStore.ets` | Asset Store 读写/删除失败（只记错误码） |
| `Chat` | `services/HermesClient.ets` | 请求开始/结束、HTTP 状态、停止与丢弃 |
| `Calendar` | `services/NativeData.ets`（日历部分） | 授权结果、实例查询成败与条数 |
| `Reminder` | `services/NativeData.ets`（提醒部分） | 注册/取消失败、通知权限拒绝 |
| `Keyboard` | `services/KeyboardAvoidance.ets` | 监听挂载/清理失败 |
| `Presentation` | `services/SystemPresentation.ets` | Toast/主题设置失败 |
| `Business` | `services/BusinessClient.ets`、`BusinessCoordinator.ets`、`BusinessRepository.ets` | 同步、冲突、游标与落盘结果 |
| `Platform` | `services/PlatformErrors.ets` | 平台失败的统一出口（操作名 + 错误码） |
| `UI` | `pages/`、`components/` 的事件处理函数 | 关键交互失败（禁止在 `build()` 内打印） |

新增 tag 的流程（三步缺一不可）：改 `Logging.ets` → 改本表 → `node scripts/check-standards.cjs` 通过。未注册的 `LogTag.xxx` 会被 `LOG-03` 拦下。

## 2. 级别语义（MUST）

| 级别 | 何时使用 | 本仓库示例 |
|---|---|---|
| `debug` | 本地开发细节，默认不保留 | 同步游标推进、冲突计数等排查值 |
| `info` | 一次正常的、可观测的状态变化 | Ability 生命周期、首页加载完成、服务端口监听 |
| `warn` | 业务可继续但结果不确定/已降级 | 事件流中断、观测失败、旧凭据清理失败 |
| `error` | 操作失败且用户可感知 | 保存失败、加载失败、未处理请求异常 |
| `fatal` | 进程级不可继续 | 当前无使用点；出现即需专项记录 |

禁止用 `info` 掩盖失败，也禁止用 `warn` 记录正常流程。级别与用户可见结果必须一致：向用户报"保存失败"的路径必须有对应的 `error` 记录。

## 3. 调用形式（MUST，逐条机检）

```ts
// 正确：常量域 + 注册 tag + 单引号字面量 + 显式占位符 + 数值错误码
hilog.error(LOG_DOMAIN, LogTag.Platform, '平台调用失败，操作=%{public}s，错误码=%{public}d', operation, platformCode(error));
hilog.info(LOG_DOMAIN, LogTag.Calendar, '日历实例查询完成，条数=%{public}d', entries.length);

// 错误：模板默认域与 tag
hilog.info(0x0000, 'testTag', 'onCreate');
// 错误：文案里拼接变量（无法机检占位符，且容易把隐私拼进去）
hilog.info(LOG_DOMAIN, LogTag.Chat, 'send ' + prompt);
// 错误：把原始错误对象或堆栈打出来
hilog.error(LOG_DOMAIN, LogTag.Ability, '加载失败: %{public}s', JSON.stringify(error));
// 错误：console，真机与日志归档只收 hilog
console.log('loaded');
```

| 规则 | 要求 |
|---|---|
| `LOG-01` | 级别只能取 `debug/info/warn/error/fatal` |
| `LOG-02` | 第 1 个参数必须是 `LOG_DOMAIN`；出现数字字面量或自定义 `DOMAIN` 常量即失败 |
| `LOG-03` | 第 2 个参数必须是 `LogTag.<Name>`，且 Name 已在注册表中 |
| `LOG-04` | 第 3 个参数必须是单个字符串字面量（禁止模板串 `\`…\``、拼接、变量） |
| `LOG-05` | 每个占位符显式写 `%{public}` 或 `%{private}`；占位符个数必须等于后续参数个数 |
| `LOG-06` | 参数名命中隐私词表（token/secret/password/credential/authorization/alias/draft/prompt/content/body/title/address/url/path/email/ref/session/message/payload/phone）时，必须使用 `%{private}` |
| `LOG-08` | 调用 `hilog` 的文件必须从 `Logging.ets` 引入 `LOG_DOMAIN` 与 `LogTag` |
| `LOG-09` | 参数中禁止 `JSON.stringify(...)`、`.stack`、`.message`、`String(err)`，只允许错误码、数量、状态、枚举、布尔 |
| `LOG-10` | 禁止在 `build()` 内打印日志（每次渲染都会执行） |
| `LOG-07` | 禁止 `console.*` |

**可见性选择**：默认 `%{private}`；只有当值确定不含用户数据（数量、错误码、状态枚举、稳定操作名）时才用 `%{public}`。`%{public}` 写错的后果是该值进入设备日志缓冲区与 `hilog` 归档，属于数据外泄。

## 4. 隐私红线（MUST）

**永不写入日志**：

- Token、refresh token、Authorization 头、Asset Store 别名全文、`credentialRef`；
- 用户输入与模型输出：提示词、草稿、消息正文、日报/记录正文、计划标题；
- 日历事件标题、参与人、地点；
- 文件绝对路径、沙箱目录、设备序列号；
- 原始 SDK `message`/堆栈（可能夹带路径与正文）；
- 请求/响应 body 与查询串（`backend` 已显式关闭 HTTP access log，见下）。

**允许写入**：稳定操作名（`asset.query`、`cache.read`）、数值错误码、条数、状态枚举、耗时、布尔、服务端生成的 operation id、协议版本。

Python 端对应要求：`backend/server.py` 的 `log_message` 已重写为空实现（不得记录 URL 与 body）；`Handler.dispatch` 的兜底分支只记录 `method + path + 异常类型`；`service.py` 的 `except` 分支记录 operation id 与异常类型，不记录上游 `message`。

## 5. 必打点（MUST）

以下位置**没有日志即为缺陷**，评审时逐一对照：

| 场景 | 位置 | 级别 |
|---|---|---|
| Ability 生命周期（onCreate/onDestroy/onWindowStageCreate/Destroy/onForeground/onBackground） | `EntryAbility.ets` | info |
| 首页加载失败 | `EntryAbility.ets` | error（含错误码） |
| 备份/恢复回调 | `EntryBackupAbility.ets` | info |
| 平台调用失败 | `PlatformErrors.ets`（统一出口） | error（含操作名与错误码） |
| 持久化读写失败、校验拒绝、迁移结果 | `WorkspaceRepository.ets`、`BusinessRepository.ets` | error / warn |
| 凭据读写与清理失败 | `CredentialStore.ets`、`ConnectionService.ets` | error |
| 日历授权拒绝、实例查询失败 | `NativeData.ets` | warn / error |
| 通知权限拒绝、提醒注册/取消失败 | `NativeData.ets` | warn / error |
| HTTP 请求结束（状态码）与停止/丢弃 | `HermesClient.ets` | info（状态码）/ warn（丢弃） |
| 业务同步结果、冲突数、游标落盘失败 | `BusinessClient/Coordinator/Repository` | info / error |
| 后端未处理请求异常 | `backend/server.py` | error |
| 后端事件流中断、观测失败 | `backend/service.py` | warning |

## 6. 文案与可检索性（SHOULD）

- 结构：`<动作><对象><结果/关键数值>`，例：`工作区原子替换失败，错误码=13900001`。
- 同一事件只在一层打印：服务层记录失败细节，页面层不再重复记录同一错误；页面层只记录用户动作引发的、服务层看不到的问题。
- 失败日志必须带错误码（`%{public}d`）或稳定原因枚举；只写"失败了"无法定位。
- 文案用中文；`hilog` 消息里不要再带模块名前缀（tag 已经承担），避免 `[Chat] Chat...`。
- 数量与耗时用 `%{public}d`；不要把整个对象序列化后当消息。

## 7. 排查路径（与 04 一致）

| 要查什么 | 命令 / 出口 |
|---|---|
| 本应用运行日志 | `bash scripts/device.sh log --app --seconds 20`（必须带 `--app`，按 pid 过滤） |
| 交互式排查 | DevEco Studio → Log 窗口 → HiLog，按 tag 过滤（现在可用 `-T Chat` 等） |
| 单模块过滤 | `hdc shell "hilog -T <Tag>"`；远端命令必须是单个字符串，`-x` 会被 hdc 吞掉 |
| 崩溃/冻屏 | `bash scripts/device.sh faults` |
| 历史日志 | 设备 `/data/log/hilog/*.gz` |
| 构建/验证 | `docs/testing/validation/<日期>-<标签>/*.log`、`results.txt` |

日志在自动化测试中的断言方式：Node 套件通过注入 mock 捕获 `hilog` 调用（`scripts/test-services.cjs` 的 `platformLogs`），断言"必须记录"与"不得记录"两类事实（例如 S32：Toast 失败不抛出，且日志不含业务正文）。

## 8. 变更流程与门禁

1. 新模块 → 先在 `Logging.ets` 注册 tag，同步本文件第 1 节表格。
2. 提交前 `node scripts/check-standards.cjs`（`bash scripts/verify.sh` 第一阶段已包含）必须无 `LOG-*`/`PY-*` 错误。
3. 规则调整（例如隐私词表扩容）必须同时改 `check-standards.cjs` 与本文件，并在 [10 问题记录](testing/10-test_record.md) 记录动机。
4. 日志规范不改变业务语义：为满足规范新增的日志不得提前返回、不得吞异常、不得影响控制流。

## 9. 增量记录

| 日期 | 变更 |
|---|---|
| 2026-10-07 | 建立规范；新增 `services/Logging.ets`（domain `0x1200` + 13 个 tag）；`EntryAbility`、`EntryBackupAbility`、`PlatformErrors` 从 `0x0000/'testTag'` 与裸 `0x1200/'HermesPlatform'` 迁移到统一常量；`backend/server.py`、`backend/service.py` 从"无日志 + 静默 pass"改为 `logging` 记录（含启动横幅替换 `print`）。 |
