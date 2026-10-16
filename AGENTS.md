# Repository Guidelines

## Project Structure & Module Organization
HermesEye is a HarmonyOS developer preview built with ArkTS, ArkUI, and the Stage model, targeting HarmonyOS 6.1.1 (API 24).

- `entry/src/main/ets/pages/Index.ets`: navigation and page state; `components/`: shared UI.
- `entry/src/main/ets/core/`: `Workspace.ts` owns V1.0 entities, migration, and validation; `Domain.ts` retains transport and legacy rules.
- `entry/src/main/ets/services/`: Hermes networking, local persistence, and native system adapters. Keep platform APIs here and reusable rules in `core/`.
- `entry/src/main/resources/` and `AppScope/resources/`: module and application assets.
- `entry/src/test/` and `entry/src/ohosTest/`: local and device Hypium suites.
- `scripts/`: build and production-code test runners; `docs/`: requirements, design, architecture, and standards; `docs/testing/`: test plan, issue log, harness reference, and all validation evidence; `releases/`: published artifacts.

## Build, Test, and Development Commands
Use DevEco Studio with the matching SDK to build and launch `entry` on a compatible emulator or device. Run commands from the repository root:

- `bash scripts/doctor.sh`: environment self-check; reports the resolved DevEco install, SDK vs project target, signing and device readiness. `--json <path>` for a machine-readable report, `--strict` to fail on warnings.
- `bash scripts/verify.sh`: the single verification entry point. Runs the coding/logging standards gate, its self-test, the resource gate, the branch-coverage gate, the six logic suites, compiles the debug HAP and the ohosTest HAP, then runs the local Hypium suite, and writes an evidence bundle under `docs/testing/validation/<date>-<label>/` (`results.txt`, `summary.json`, per-stage logs, `standards.json`, `coverage.json`). Use `--skip-build` for a seconds-long logic-only pass, `--deny-arkts-warnings` to fail on compiler warnings, `--label <name>` to name the evidence directory.
- `node scripts/check-standards.cjs`: executable coding/logging standards gate from `docs/15-coding-standard.md` and `docs/16-logging-standard.md`; `--json <path>` writes a machine-readable report, `--list-rules` prints the rule registry.
- `node scripts/test-standards.cjs`: unit tests for the gate itself (37 fixtures/CLI cases); `node scripts/test-resources.cjs` checks `$r('app.string/color.*')` references and base/dark pairing; `node scripts/coverage.cjs` measures V8 block/line coverage and enforces the `docs/15 §8.1` floors; `node scripts/python-coverage.cjs` enforces the backend Python line-coverage floors.
- `node scripts/test-ui-flows.cjs`: simulated click-through business flows against production page handlers and core rules.
- `node scripts/test-domain.cjs`: tests production domain rules.
- `node scripts/test-services.cjs`: tests HTTP and persistence adapters with injected platform mocks.
- `node scripts/test-workspace.cjs`: validates V1.0 isolation, migration, and secure-save failures.
- `node scripts/test-business.cjs`: business replica, coordinator, and durable-intent rules.
- `bash scripts/test-deveco.sh`: legacy macOS runner; equivalent to the build path of `scripts/verify.sh`. Prefer `scripts/verify.sh` for new work.
- `bash scripts/device.sh`: emulator/device acceptance. `status` lists targets, `install` installs both HAPs, `test` runs the ohosTest suite over hdc, `log --app` captures this app's hilog, `faults` pulls crash/freeze logs. Works for an emulator and a real device through the same interface once signing is configured.
- `./scripts/build.ps1 -Mode debug`: builds a debug HAP in PowerShell.
- `./scripts/build.ps1 -Mode release`: builds a release HAP; without signing configuration, output is unsigned.

`scripts/lib/deveco-env.sh` and `scripts/lib/deveco-env.cjs` are the single source of truth for locating DevEco Studio; the shell and Node resolvers probe the same candidate list (macOS `/Applications/DevEco-Studio.app/Contents`, Windows `D:/dev-tools/DevEco Studio`, Linux `~/DevEco-Studio`) and `DEVECO_HOME` overrides both. The Node runners no longer hardcode a Windows path, so a bare `node scripts/test-domain.cjs` works on any platform with a default install. Override the PowerShell build script's installation path separately with `-DevEcoHome`.

The Node logic suites transpile production sources in memory and assert on them; they need no device and no network. `scripts/verify.sh` is the required gate before claiming a change builds. Note that a green pipeline is compile and logic evidence only: it does not sign, install, or exercise permissions, reminders, or the real Hermes backend.


## Coding Style & Naming Conventions
The normative rules live in [docs/15 · 编码规范](docs/15-coding-standard.md) (layering, naming, types, error semantics, ArkUI, security, testing) and [docs/16 · 日志打印规范](docs/16-logging-standard.md) (hilog domain/tag registry, levels, privacy, mandatory log points). `node scripts/check-standards.cjs` enforces every machine-checkable rule and is the first `scripts/verify.sh` stage; a violation marked `error` fails the pipeline. In short: two-space indentation, single-quoted strings, semicolons, PascalCase classes/interfaces/component filenames, camelCase functions and variables, explicit types at service boundaries, Chinese user-facing copy, semantic color resources for both themes, and no `0x0000`/`testTag` logging. DevEco code analysis uses `code-linter.json5` (IDE-side only; the headless CLI is unusable, see `docs/testing/13-harmony-harness.md`).

## Testing Guidelines
Add descriptive behavior cases to the Node assertion runners for domain or service changes, covering both success and failure paths. Name Hypium suites `*.test.ets` and register them in the corresponding `List.test.ets`. Branch-coverage floors are defined in [docs/15 §8.1](docs/15-coding-standard.md): 100% of `core/*.ts` blocks, ≥95% of `services/*.ets` lines, ≥90% of the standards gate itself; `scripts/coverage.cjs` measures them. Run the logic suites and compile relevant changes. Follow `docs/testing/04-test-plan.md` for device acceptance; mocks do not verify permissions, reminders, or real Hermes integration. Record acceptance results in `docs/05-release.md`.

## Commit & Pull Request Guidelines
History currently contains one `feat:` commit. Follow that prefix style with concise imperative subjects, such as `fix: preserve records after save failure`. PRs should explain behavior changes, link relevant issues, report validation and untested device scenarios, and include screenshots for UI changes.

## Security & Configuration
Never commit tokens, signing material, or local configuration. Store tokens only in Asset Store; keep them out of ordinary persistence, logs, backups, and business sync. Preserve explicit context-sharing consent, HTTPS defaults, opt-in private-network HTTP, and disabled automatic request retries.

## Documentation Navigation / 文档导航

阅读顺序：先确认 **08 产品范围 → 09 交互设计**，再查对应模块规格、架构与实现说明；修改后对照 **04 测试计划 → 10 问题记录 → 05 验收记录**（04/10 与全部证据位于 `docs/testing/`）。需求和草图不代表已实现，构建或逻辑测试通过不代表设备验收通过。新增、移动或删除 `docs/` 文件时同步维护本导航；新增测试用例时同步对应文档。

### 每日计划文档持续维护约束

自 2026-10-04 起，后续每轮涉及每日计划的交互，都应在该轮结束前把有实质意义的内容沉淀到模块文档，不能仅更新代码或只在聊天中说明。

- 需求补充、用户反馈、约束、字段与业务规则、页面及交互决策：同步更新 `docs/modules/11-daily-plan-spec.md` 的对应章节，保持当前有效规格一致。
- 本轮讨论结论、决策理由、实现变更、实际验证、未验证范围与待办：按日期追加到 `docs/modules/12-daily-plan-implementation.md`，保留演进过程；纯讨论轮也记录结论与待定项。
- 涉及界面变化时同步对应交互稿；涉及实测问题或验收状态时同步 `docs/testing/10-test_record.md`、`docs/05-release.md`；影响总体范围、设计或架构时更新对应上层文档。
- 区分用户明确要求、实施建议、待确认事项、已实现与已验证，不将讨论内容直接写成已验收结论；规则被替代时注明日期和原因。无需逐字复制聊天，不记录凭据等敏感信息。

### 产品、设计与工程文档

| 文档 | 用途 |
|---|---|
| [08 · 产品需求 V1.0](docs/08-product-requirements-V1.0.md) | 已确认的产品范围、场景与验收目标；作为 V1.0 范围依据 |
| [09 · 前端设计 V1.0](docs/09-frontend-design-V1.0.md) | 页面结构、交互逻辑、授权与视觉约束 |
| [14 · 前端设计 V2.0](docs/14-frontend-design-V2.0.md) | 卡片化、完成框、悬浮导航与左右会话；2026-10-11 已授权在 dev 实施，业务范围沿用 V1 |
| [21 · V2 前端实施与验证](docs/21-frontend-v2-implementation.md) | dev 分支实现映射、验证结果与未验收范围 |
| [07 · 视觉规范 V0.2](docs/07-visual-design-V0.2.md) | V1.0 继承的色彩、字体、间距及触控设计基线 |
| [01 · 产品需求与实现索引](docs/01-product-requirements.md) | 产品定位与当前实现映射，不替代完整需求 |
| [02 · 前端实现说明](docs/02-design.md) | 当前页面组织与 UI 落地说明 |
| [03 · 架构与接口边界](docs/03-architecture.md) | 分层、存储、网络与原生能力边界 |
| [05 · 重构与验收记录](docs/05-release.md) | 已执行验证、交付范围、限制与发布阻塞 |
| [06 · 推进与交付清单](docs/06-project-plan.md) | 工作包、完成门槛及待联调事项 |
| [15 · 编码规范 V1.0](docs/15-coding-standard.md) | 分层、命名、类型、错误语义、ArkUI、安全、测试与覆盖率下限；规则 ID 与 `scripts/check-standards.cjs` 一一对应 |
| [16 · 日志打印规范 V1.0](docs/16-logging-standard.md) | hilog domain/tag 注册表、级别语义、调用形式、隐私红线、必打点、排查路径 |

### 测试与验证文档（`docs/testing/`）

测试相关的文档与全部验证证据集中在此目录，顶层 `docs/` 只保留产品、设计、架构与规范文档。

| 文档 | 用途 |
|---|---|
| [04 · 测试与验收计划](docs/testing/04-test-plan.md) | 测试层次与命令、用例总览、覆盖率下限、模拟点击用例、设备与端到端验收矩阵 |
| [10 · 模拟器/真机问题记录](docs/testing/10-test_record.md) | 实测现象、根因、修复方案、回归设计与结果（问题 1–16） |
| [13 · 鸿蒙开发 Harness 能力清单](docs/testing/13-harmony-harness.md) | `doctor`/`verify`/`device` 能力、入口与参数、能力边界、已实现但不可达项、已知限制与维护约束 |
| [验证证据目录](docs/testing/validation/) | 每个批次的 `results.txt`、`summary.json`、阶段日志、设备 transcript 与截图；目录存在不等于当前版本通过 |

### 模块文档与交互草图

模块文档细化对应功能；草图用于核对界面和操作流程，实际交付状态查实现与验收记录。

| 文档 | 用途 |
|---|---|
| [11 · 每日计划需求规格与设计](docs/modules/11-daily-plan-spec.md) | 每日计划模块的需求、数据与交互规则 |
| [12 · 每日计划开发与交付记录](docs/modules/12-daily-plan-implementation.md) | 模块实施过程、验证与交付边界 |
| [17 · 项目需求规格与交互设计](docs/modules/17-project-spec.md) | 个人目标项目、Hermes闭环与未来远程多Agent构建规格 |
| [18 · 项目开发与交付记录](docs/modules/18-project-implementation.md) | 项目模块实现、验证限制与后续边界 |
| [19 · 阅读获取、整理与疑问规格](docs/modules/19-reading-spec.md) | V1 授权来源、周期、百分数进度、来源引用与操作恢复 |
| [20 · 阅读设计与交付记录](docs/modules/20-reading-design-record.md) | 阅读范围演进、V1 实施与实际验证边界 |
| [阅读 V1 交互原型](docs/design/reading/index.html) | 普通卡片、必要设置与明确来源提问；非私人数据或设备证据 |
| [项目模块交互原型](docs/design/projects/index.html) | 项目列表、目标、里程碑、复盘与状态演示；非设备证据 |
| [首页与导航草图](docs/design/V1.0/home-and-navigation.html) | 首页、项目、阅读与基本流程；早期比较选项以 09 的最终规则为准 |
| [连接与需求会话草图](docs/design/V1.0/connection-and-needs.html) | 连接配置、需求会话及导航视觉参考 |
| [每日计划交互设计稿](docs/design/daily-plan/index.html) | 每日计划模块的页面与交互原型 |
| [V2.0 项目毛玻璃交互稿](docs/design/V2.0/projects-glass.html) | 项目卡片、状态菜单、需求分流与浅深色/实色评审 |
| [项目毛玻璃列表](docs/design/V2.0/projects-glass-list.png)、[详情](docs/design/V2.0/projects-glass-detail.png)、[深色](docs/design/V2.0/projects-glass-dark.png) | 浏览器设计预览，不是设备验收证据 |
| [V2.0 极简左右会话](docs/design/V2.0/conversations.html) | 全需求会话布局、上下文及异常状态设计；浅色/深色浏览器截图尚未提供 |
| [V2.0 全页面卡片交互稿](docs/design/V2.0/index.html) | 24 个页面场景、详情与编辑卡片；纯设计示例 |
| [应用图标设计与资源](docs/design/brand/README.md) | 眼睛＋负形H、葱青/米白配色、SVG源稿、分层PNG及启动图导出 |
| [V2.0 事项详情预览图](docs/design/V2.0/task-detail.png) | 浏览器设计截图，不是设备验收证据 |
| [V2.0 悬浮胶囊导航预览图](docs/design/V2.0/floating-navigation.png) | 四入口保持不变的悬浮底栏视觉评审；不是设备验收证据 |

### 验证证据

证据统一落在 `docs/testing/validation/`。自2026-10-09起，该目录仅保留本地，禁止提交或使用 `git add -f` 上传；历史路径 `docs/validation/` 同样忽略。下方证据链接是本地导航，在GitHub或新克隆中不可用；可提交的验证结论保留在05、10等文档中。以下文件记录指定批次的结果，不自动代表当前版本全部通过；结论与未测范围以 05、10 及模块交付记录为准。

| 批次 | 结果与截图 |
|---|---|
| V2 前端 · 2026-10-11 | [15/15门禁](docs/testing/validation/2026-10-11-v2-release-ready/results.txt)、[设备12/12](docs/testing/validation/2026-10-11-v2-release-device/device-test.txt)；实施映射和边界见21，证据仅本地 |
| V1 项目/阅读 · 2026-10-11 | [14/14 门禁](docs/testing/validation/2026-10-11-v1-project-reading-final/results.txt)、[覆盖率](docs/testing/validation/2026-10-11-v1-project-reading-final/coverage.json)、[最终设备回归](docs/testing/validation/2026-10-11-v1-project-reading-device-final/device-test.txt)；实际结果及边界见05，仅本地证据 |
| V1.0 基线 | [自动验证摘录](docs/testing/validation/V1.0/automated-results.txt)、[Hypium 结果](docs/testing/validation/V1.0/hypium-result.txt) |
| 键盘修复 · 2026-10-02 | [设备测试](docs/testing/validation/keyboard-2026-10-02/device-tests.txt)、[Previewer 测试](docs/testing/validation/keyboard-2026-10-02/previewer-tests.txt)、[键盘展开截图](docs/testing/validation/keyboard-2026-10-02/keyboard-open.png)、[键盘滚动截图](docs/testing/validation/keyboard-2026-10-02/keyboard-scroll.png) |
| 测试重设计 · 2026-10-03 | [测试结果](docs/testing/validation/test-redesign-2026-10-03/results.txt) |
| 问题 1–5 回归 · 2026-10-03 | [测试结果](docs/testing/validation/issues-1-5-tests-2026-10-03/results.txt) |
| 每日计划 · 2026-10-03 | [验证结果](docs/testing/validation/daily-plan-2026-10-03/results.txt)、[Previewer 结果](docs/testing/validation/daily-plan-2026-10-03/previewer.txt) |
| Harness 构建/验证 · 2026-10-04 | [验证结果](docs/testing/validation/2026-10-04-final/results.txt)、[摘要](docs/testing/validation/2026-10-04-final/summary.json)（7/7 阶段通过；含 21 条 ArkTS 告警基线，见 [10](docs/testing/10-test_record.md) 问题8） |
| 模拟器设备验收 · 2026-10-04 | [设备测试](docs/testing/validation/2026-10-04-device/device-test.txt)（4/4 通过）、[hilog（gzip 压缩）](docs/testing/validation/2026-10-04-device/hilog.txt.gz) |
| 崩溃日志排查 · 2026-10-05 | [faultlog 索引](docs/testing/validation/2026-10-05-device/faultlog/index.txt)（2 条 2026-10-01 历史 jscrash，当前构建未复现，根因未定位）、[应用日志](docs/testing/validation/2026-10-05-device/hilog.txt) |
| 编码/日志规范门禁 · 2026-10-07 | [10/10 阶段结果](docs/testing/validation/2026-10-07-coding-standards/results.txt)、[机读规范报告](docs/testing/validation/2026-10-07-coding-standards/standards.json)、[摘要](docs/testing/validation/2026-10-07-coding-standards/summary.json)（0 error / 14 存量 warning，ArkTS 零告警） |
| 测试重构建与覆盖率 · 2026-10-07 | [最终 13/13 阶段结果](docs/testing/validation/2026-10-07-final-test-rebuild/results.txt)、[覆盖率报告](docs/testing/validation/2026-10-07-final-test-rebuild/coverage.json)（core 100%/100%，services 99.6%/99.3%）、[摘要](docs/testing/validation/2026-10-07-final-test-rebuild/summary.json) |
| 模拟点击设备验收 · 2026-10-07 | [设备 8/8](docs/testing/validation/2026-10-07-click-flows-device/device-test.txt)（模拟器 API 26，含 U08/U09）、[问题11诊断留档](docs/testing/validation/2026-10-07-click-flows-diag3/device-test.txt) |
| 测试文档归集 · 2026-10-07 | [归集后 13/13 阶段结果](docs/testing/validation/2026-10-07-docs-restructure/results.txt)（证据改落 `docs/testing/validation/`，链接与导航审计通过） |
| 项目模块用例补充 · 2026-10-09 | [14/14 阶段结果](docs/testing/validation/2026-10-09-project-module-tests/results.txt)、[覆盖率](docs/testing/validation/2026-10-09-project-module-tests/coverage.json)（core 100%/100%）、[设备 10/10](docs/testing/validation/2026-10-09-project-module-device/device-test.txt)（证据目录仅本地保留，不提交） |
| V2 联调与外部能力 · 2026-10-11 | [15/15 门禁](docs/testing/validation/2026-10-11-v2-baseline/results.txt)、[设备 12/12](docs/testing/validation/2026-10-11-v2-device-final/device-test.txt)、[日历读取 2 条日程](docs/testing/validation/2026-10-11-calendar-probe/device-test.txt)、[真实 Hermes 往返通过](docs/testing/validation/2026-10-11-hermes-live-v2/)（运动健康未接入；仅本地保留） |
| 阅读/业务用例补充 · 2026-10-11 | [15/15 阶段结果](docs/testing/validation/2026-10-11-reading-tests/results.txt)、[ArkTS 覆盖率](docs/testing/validation/2026-10-11-reading-tests/coverage.json)（core/组件 100%，services 99.6%/99.3%）、[后端覆盖 100%](docs/testing/validation/2026-10-11-reading-tests/backend-coverage.json)、[设备 12/12](docs/testing/validation/2026-10-11-reading-tests-device/device-test.txt)（仅本地保留） |

问题8追加验证（2026-10-06）：[最终零告警结果](docs/testing/validation/2026-10-06-issue8-final/results.txt)、[摘要](docs/testing/validation/2026-10-06-issue8-final/summary.json)、[设备回归](docs/testing/validation/2026-10-06-issue8-device/device-test.txt)。迭代留档：[先行逻辑回归](docs/testing/validation/2026-10-06-issue8-logic/results.txt)、[首次编译诊断](docs/testing/validation/2026-10-06-issue8/results.txt)。实际覆盖及未测范围见 05、10。

### Agent 技能

`.dsh/skills/` 下的技能由 DSH 以项目根最高优先级自动发现（改动即时生效，无需重启）：

| 技能 | 何时生效 |
|---|---|
| `harmonyos-arkts` | 编写/修改 ArkTS、ArkUI 代码：语言约束、`@throws` 处理规则、状态管理、资源与主题、安全红线 |
| `harmonyos-harness` | 构建、验证、设备验收：`doctor`/`verify`/`device` 用法与边界、证据约定、三层测试取舍、已知限制与真机预留 |

### 历史文档 · V0.2

仅用于追溯旧版本设计和决策，不作为当前 V1.0 范围依据。根目录的 07 视觉规范仍被 V1.0 引用，与本历史归档区分。

| 文档 | 用途 |
|---|---|
| [历史 01 · 产品需求](docs/history/V0.2/01-product-requirements.md) | 旧开发预览的产品范围 |
| [历史 02 · 页面与交互设计](docs/history/V0.2/02-design.md) | 旧页面结构与交互说明 |
| [历史 03 · 架构与决策](docs/history/V0.2/03-architecture.md) | 旧分层与技术决策 |
| [历史 04 · 测试与验收计划](docs/history/V0.2/04-test-plan.md) | 旧验收矩阵 |
| [历史 05 · 开发预览发布报告](docs/history/V0.2/05-release.md) | v0.1.0 自测和发布记录 |
| [历史 06 · 推进与交付清单](docs/history/V0.2/06-project-plan.md) | 旧里程碑与推进状态 |

### 独立业务服务本地预览（2026-10-07）

- [业务服务运行与协议](backend/README.md)：Python/SQLite 服务、独立凭据、回环启动、接口与限制。
- [架构实施状态](docs/03-architecture.md#13-a2-本地实施--2026-10-07)：本地共享基础已实现与完整 V1.0 尚待接入范围。
- `node scripts/test-business.cjs` 和 `python3 -m unittest discover -s backend/tests -v` 已纳入 `scripts/verify.sh`；规范门禁、门禁自测、资源检查、ArkTS 覆盖率与后端覆盖率加入后完整15阶段，逻辑快速路径11阶段。Python要求3.10+，服务启动支持macOS/Linux，HTTP测试需要回环监听权限。

- [业务预览交互稿](docs/design/business-preview.html)：独立副本连接、冲突、发送与恢复流程。
- 本地架构验证：[最终结果](docs/testing/validation/2026-10-07-architecture-v1-verified/results.txt)、[摘要](docs/testing/validation/2026-10-07-architecture-v1-verified/summary.json)、[环境](docs/testing/validation/2026-10-07-architecture-v1-verified/doctor.json)。迭代：[首次诊断](docs/testing/validation/2026-10-07-architecture-v1/results.txt)、[首轮通过](docs/testing/validation/2026-10-07-architecture-v1-final/results.txt)、[存储保护回归](docs/testing/validation/2026-10-07-architecture-v1-complete/results.txt)。设备安装：[超时重试](docs/testing/validation/2026-10-07-architecture-v1-device/install-retry.txt)、[传输诊断](docs/testing/validation/2026-10-07-architecture-v1-device/transport-diagnostic.txt)、[分步安装](docs/testing/validation/2026-10-07-architecture-v1-device/manual-install.txt)。
- 真实 Hermes 本机联调 · 2026-10-07：[脱敏摘要](docs/testing/validation/2026-10-07-hermes-live/results.txt)、[结构化结果](docs/testing/validation/2026-10-07-hermes-live/results.json)。覆盖真实原生会话与业务账本恢复，不代表手机网络、上游重启或工具执行已验收。
- HAP部署恢复 · 2026-10-07：[重连](docs/testing/validation/2026-10-07-deploy-recovery/reconnect.txt)、[文件传输](docs/testing/validation/2026-10-07-deploy-recovery/transport-restored.txt)、[安装](docs/testing/validation/2026-10-07-deploy-recovery/install.txt)、[启动](docs/testing/validation/2026-10-07-deploy-recovery/launch.txt)、[设备回归6/6](docs/testing/validation/2026-10-07-deploy-recovery/device-test.txt)。问题9已恢复，底层单一根因未确定。


### 当前分支实施范围 · 2026-10-11

用户已授权 `dev` 实施V2前端；界面以14及“前端设计&交互逻辑设计”会话为依据，沿用08与模块规格的业务、安全和数据规则。旧记录中的“仅设计/暂不实现V2”为历史状态。当前验证与限制见21；模拟点击20组，设备12项，证据仍仅本地保留。
