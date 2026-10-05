# Repository Guidelines

## Project Structure & Module Organization
HermesEye is a HarmonyOS developer preview built with ArkTS, ArkUI, and the Stage model, targeting HarmonyOS 6.1.1 (API 24).

- `entry/src/main/ets/pages/Index.ets`: navigation and page state; `components/`: shared UI.
- `entry/src/main/ets/core/`: `Workspace.ts` owns V1.0 entities, migration, and validation; `Domain.ts` retains transport and legacy rules.
- `entry/src/main/ets/services/`: Hermes networking, local persistence, and native system adapters. Keep platform APIs here and reusable rules in `core/`.
- `entry/src/main/resources/` and `AppScope/resources/`: module and application assets.
- `entry/src/test/` and `entry/src/ohosTest/`: local and device Hypium suites.
- `scripts/`: build and production-code test runners; `docs/`: requirements, architecture, and acceptance plans; `releases/`: published artifacts.

## Build, Test, and Development Commands
Use DevEco Studio with the matching SDK to build and launch `entry` on a compatible emulator or device. Run commands from the repository root:

- `bash scripts/doctor.sh`: environment self-check; reports the resolved DevEco install, SDK vs project target, signing and device readiness. `--json <path>` for a machine-readable report, `--strict` to fail on warnings.
- `bash scripts/verify.sh`: the single verification entry point. Runs the three logic suites, compiles the debug HAP and the ohosTest HAP, then runs the local Hypium suite, and writes an evidence bundle under `docs/validation/<date>-<label>/` (`results.txt`, `summary.json`, per-stage logs). Use `--skip-build` for a seconds-long logic-only pass, `--deny-arkts-warnings` to fail on compiler warnings, `--label <name>` to name the evidence directory.
- `node scripts/test-domain.cjs`: tests production domain rules.
- `node scripts/test-services.cjs`: tests HTTP and persistence adapters with injected platform mocks.
- `node scripts/test-workspace.cjs`: validates V1.0 isolation, migration, and secure-save failures.
- `bash scripts/test-deveco.sh`: legacy macOS runner; equivalent to the build path of `scripts/verify.sh`. Prefer `scripts/verify.sh` for new work.
- `bash scripts/device.sh`: emulator/device acceptance. `status` lists targets, `install` installs both HAPs, `test` runs the ohosTest suite over hdc, `log --app` captures this app's hilog, `faults` pulls crash/freeze logs. Works for an emulator and a real device through the same interface once signing is configured.
- `./scripts/build.ps1 -Mode debug`: builds a debug HAP in PowerShell.
- `./scripts/build.ps1 -Mode release`: builds a release HAP; without signing configuration, output is unsigned.

`scripts/lib/deveco-env.sh` and `scripts/lib/deveco-env.cjs` are the single source of truth for locating DevEco Studio; the shell and Node resolvers probe the same candidate list (macOS `/Applications/DevEco-Studio.app/Contents`, Windows `D:/dev-tools/DevEco Studio`, Linux `~/DevEco-Studio`) and `DEVECO_HOME` overrides both. The Node runners no longer hardcode a Windows path, so a bare `node scripts/test-domain.cjs` works on any platform with a default install. Override the PowerShell build script's installation path separately with `-DevEcoHome`.

The three Node suites transpile production sources in memory and assert on them; they need no device and no network. `scripts/verify.sh` is the required gate before claiming a change builds. Note that a green pipeline is compile and logic evidence only: it does not sign, install, or exercise permissions, reminders, or the real Hermes backend.


## Coding Style & Naming Conventions
Follow existing two-space indentation, single-quoted strings, and semicolons. Use PascalCase for classes, interfaces, and component filenames; camelCase for functions and variables. Keep explicit types at service boundaries. Preserve Chinese user-facing copy. Follow `docs/08-product-requirements-V1.0.md` and `docs/09-frontend-design-V1.0.md`; use semantic color resources for both themes. Use DevEco code analysis with `code-linter.json5`, which configures performance, TypeScript, and security rules; no standalone formatter is configured.

## Testing Guidelines
Add descriptive behavior cases to the Node assertion runners for domain or service changes. Name Hypium suites `*.test.ets` and register them in the corresponding `List.test.ets`. No numerical coverage threshold is configured. Run all three logic suites and compile relevant changes. Follow `docs/04-test-plan.md` for device acceptance; mocks do not verify permissions, reminders, or real Hermes integration. Record acceptance results in `docs/05-release.md`.

## Commit & Pull Request Guidelines
History currently contains one `feat:` commit. Follow that prefix style with concise imperative subjects, such as `fix: preserve records after save failure`. PRs should explain behavior changes, link relevant issues, report validation and untested device scenarios, and include screenshots for UI changes.

## Security & Configuration
Never commit tokens, signing material, or local configuration. Store tokens only in Asset Store; keep them out of ordinary persistence, logs, backups, and business sync. Preserve explicit context-sharing consent, HTTPS defaults, opt-in private-network HTTP, and disabled automatic request retries.

## Documentation Navigation / 文档导航

阅读顺序：先确认 **08 产品范围 → 09 交互设计**，再查对应模块规格、架构与实现说明；修改后对照 **04 测试计划 → 10 问题记录 → 05 验收记录**。需求和草图不代表已实现，构建或逻辑测试通过不代表设备验收通过。新增、移动或删除 `docs/` 文件时同步维护本导航。

### 每日计划文档持续维护约束

自 2026-10-04 起，后续每轮涉及每日计划的交互，都应在该轮结束前把有实质意义的内容沉淀到模块文档，不能仅更新代码或只在聊天中说明。

- 需求补充、用户反馈、约束、字段与业务规则、页面及交互决策：同步更新 `docs/modules/11-daily-plan-spec.md` 的对应章节，保持当前有效规格一致。
- 本轮讨论结论、决策理由、实现变更、实际验证、未验证范围与待办：按日期追加到 `docs/modules/12-daily-plan-implementation.md`，保留演进过程；纯讨论轮也记录结论与待定项。
- 涉及界面变化时同步对应交互稿；涉及实测问题或验收状态时同步 `docs/10-test_record.md`、`docs/05-release.md`；影响总体范围、设计或架构时更新对应上层文档。
- 区分用户明确要求、实施建议、待确认事项、已实现与已验证，不将讨论内容直接写成已验收结论；规则被替代时注明日期和原因。无需逐字复制聊天，不记录凭据等敏感信息。

### 产品、设计与工程文档

| 文档 | 用途 |
|---|---|
| [08 · 产品需求 V1.0](docs/08-product-requirements-V1.0.md) | 已确认的产品范围、场景与验收目标；作为 V1.0 范围依据 |
| [09 · 前端设计 V1.0](docs/09-frontend-design-V1.0.md) | 页面结构、交互逻辑、授权与视觉约束 |
| [07 · 视觉规范 V0.2](docs/07-visual-design-V0.2.md) | V1.0 继承的色彩、字体、间距及触控设计基线 |
| [01 · 产品需求与实现索引](docs/01-product-requirements.md) | 产品定位与当前实现映射，不替代完整需求 |
| [02 · 前端实现说明](docs/02-design.md) | 当前页面组织与 UI 落地说明 |
| [03 · 架构与接口边界](docs/03-architecture.md) | 分层、存储、网络与原生能力边界 |
| [04 · 测试与验收计划](docs/04-test-plan.md) | 测试层次、运行方式及自动/设备验收矩阵 |
| [05 · 重构与验收记录](docs/05-release.md) | 已执行验证、交付范围、限制与发布阻塞 |
| [06 · 推进与交付清单](docs/06-project-plan.md) | 工作包、完成门槛及待联调事项 |
| [10 · 模拟器/真机问题记录](docs/10-test_record.md) | 实测现象、根因、修复方案、回归设计与结果 |

### 模块文档与交互草图

模块文档细化对应功能；草图用于核对界面和操作流程，实际交付状态查实现与验收记录。

| 文档 | 用途 |
|---|---|
| [11 · 每日计划需求规格与设计](docs/modules/11-daily-plan-spec.md) | 每日计划模块的需求、数据与交互规则 |
| [12 · 每日计划开发与交付记录](docs/modules/12-daily-plan-implementation.md) | 模块实施过程、验证与交付边界 |
| [首页与导航草图](docs/design/V1.0/home-and-navigation.html) | 首页、项目、阅读与基本流程；早期比较选项以 09 的最终规则为准 |
| [连接与需求会话草图](docs/design/V1.0/connection-and-needs.html) | 连接配置、需求会话及导航视觉参考 |
| [每日计划交互设计稿](docs/design/daily-plan/index.html) | 每日计划模块的页面与交互原型 |

### 验证证据

以下文件记录指定批次的结果，不自动代表当前版本全部通过；结论与未测范围以 05、10 及模块交付记录为准。

| 批次 | 结果与截图 |
|---|---|
| V1.0 基线 | [自动验证摘录](docs/validation/V1.0/automated-results.txt)、[Hypium 结果](docs/validation/V1.0/hypium-result.txt) |
| 键盘修复 · 2026-10-02 | [设备测试](docs/validation/keyboard-2026-10-02/device-tests.txt)、[Previewer 测试](docs/validation/keyboard-2026-10-02/previewer-tests.txt)、[键盘展开截图](docs/validation/keyboard-2026-10-02/keyboard-open.png)、[键盘滚动截图](docs/validation/keyboard-2026-10-02/keyboard-scroll.png) |
| 测试重设计 · 2026-10-03 | [测试结果](docs/validation/test-redesign-2026-10-03/results.txt) |
| 问题 1–5 回归 · 2026-10-03 | [测试结果](docs/validation/issues-1-5-tests-2026-10-03/results.txt) |
| 每日计划 · 2026-10-03 | [验证结果](docs/validation/daily-plan-2026-10-03/results.txt)、[Previewer 结果](docs/validation/daily-plan-2026-10-03/previewer.txt) |
| Harness 构建/验证 · 2026-10-04 | [验证结果](docs/validation/2026-10-04-final/results.txt)、[摘要](docs/validation/2026-10-04-final/summary.json)（7/7 阶段通过；含 21 条 ArkTS 告警基线，见 [10](docs/10-test_record.md) 问题8） |
| 模拟器设备验收 · 2026-10-04 | [设备测试](docs/validation/2026-10-04-device/device-test.txt)（4/4 通过）、[hilog（gzip 压缩）](docs/validation/2026-10-04-device/hilog.txt.gz) |
| 崩溃日志排查 · 2026-10-05 | [faultlog 索引](docs/validation/2026-10-05-device/faultlog/index.txt)（2 条 2026-10-01 历史 jscrash，当前构建未复现，根因未定位）、[应用日志](docs/validation/2026-10-05-device/hilog.txt) |

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
