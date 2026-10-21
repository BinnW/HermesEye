# Repository Guidelines

## Project Structure & Module Organization
HermesEye is a HarmonyOS developer preview built with ArkTS, ArkUI, and the Stage model, targeting HarmonyOS 6.1.1 (API 24).

- `entry/src/main/ets/pages/Index.ets`: navigation and page state; `components/`: shared UI.
- `entry/src/main/ets/core/`: `Workspace.ts` owns V1.0 entities, migration, and validation; `Domain.ts` retains transport and legacy rules.
- `entry/src/main/ets/services/`: Hermes networking, local persistence, and native system adapters. Keep platform APIs here and reusable rules in `core/`.
- `entry/src/main/resources/` and `AppScope/resources/`: module and application assets.
- `entry/src/test/` and `entry/src/ohosTest/`: local and device Hypium suites.
- `scripts/`: build and production-code test runners; `releases/`: published artifacts.
- `docs/README.md`: documentation index. Five categories: `docs/design/` (requirements, design, architecture, standards and prototypes), `docs/modules/` (feature specifications and implementation records), `docs/plans/` (project delivery plans), `docs/issues/` (issue and fix records), `docs/testing/` (test plans, acceptance, harness and local evidence). Module documents are grouped by `frontend/`, `daily-plan/`, `projects/` and `reading/`.

## Build, Test, and Development Commands
Use DevEco Studio with the matching SDK to build and launch `entry` on a compatible emulator or device. Run commands from the repository root:

- `bash scripts/doctor.sh`: environment self-check; reports the resolved DevEco install, SDK vs project target, signing and device readiness. `--json <path>` for a machine-readable report, `--strict` to fail on warnings.
- `bash scripts/verify.sh`: the single verification entry point. Runs the coding/logging standards gate, its self-test, the resource gate, the branch-coverage gate, the six logic suites, compiles the debug HAP and the ohosTest HAP, then runs the local Hypium suite, and writes an evidence bundle under `docs/testing/validation/<date>-<label>/` (`results.txt`, `summary.json`, per-stage logs, `standards.json`, `coverage.json`). Use `--skip-build` for a seconds-long logic-only pass, `--deny-arkts-warnings` to fail on compiler warnings, `--label <name>` to name the evidence directory.
- `node scripts/check-standards.cjs`: executable coding/logging standards gate from `docs/design/15-coding-standard.md` and `docs/design/16-logging-standard.md`; `--json <path>` writes a machine-readable report, `--list-rules` prints the rule registry.
- `node scripts/test-standards.cjs`: unit tests for the gate itself (37 fixtures/CLI cases); `node scripts/test-resources.cjs` checks `$r('app.string/color.*')` references and base/dark pairing; `node scripts/coverage.cjs` measures V8 block/line coverage and enforces the `docs/design/15 §8.1` floors; `node scripts/python-coverage.cjs` enforces the backend Python line-coverage floors.
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
The normative rules live in [docs/design/15 · 编码规范](docs/design/15-coding-standard.md) (layering, naming, types, error semantics, ArkUI, security, testing) and [docs/design/16 · 日志打印规范](docs/design/16-logging-standard.md) (hilog domain/tag registry, levels, privacy, mandatory log points). `node scripts/check-standards.cjs` enforces every machine-checkable rule and is the first `scripts/verify.sh` stage; a violation marked `error` fails the pipeline. In short: two-space indentation, single-quoted strings, semicolons, PascalCase classes/interfaces/component filenames, camelCase functions and variables, explicit types at service boundaries, Chinese user-facing copy, semantic color resources for both themes, and no `0x0000`/`testTag` logging. DevEco code analysis uses `code-linter.json5` (IDE-side only; the headless CLI is unusable, see `docs/testing/13-harmony-harness.md`).

## Testing Guidelines
Add descriptive behavior cases to the Node assertion runners for domain or service changes, covering both success and failure paths. Name Hypium suites `*.test.ets` and register them in the corresponding `List.test.ets`. Branch-coverage floors are defined in [docs/design/15 §8.1](docs/design/15-coding-standard.md): 100% of `core/*.ts` blocks, ≥95% of `services/*.ets` lines, ≥90% of the standards gate itself; `scripts/coverage.cjs` measures them. Run the logic suites and compile relevant changes. Follow `docs/testing/04-test-plan.md` for device acceptance; mocks do not verify permissions, reminders, or real Hermes integration. Record acceptance results in `docs/testing/05-release.md`.

### 工作区测试约定（触发词「进行测试」）

当用户在本仓库会话中发送「进行测试」（或含义相同的简短指令）时，一律映射为**对工作区未提交的改动进行测试**，不另行询问范围，按以下顺序执行：

1. 识别未提交改动：`git status --short` 与 `git diff --stat`（排除 `docs/testing/validation/` 等 gitignored 证据与本地凭据文件）。
2. 运行完整门禁：`bash scripts/verify.sh --deny-arkts-warnings --label workspace-test`（verify 会自动在证据目录名加日期前缀；覆盖规范、资源、覆盖率、逻辑/流程/后端套件、编译与本地 Hypium）。
3. 按改动类型补专项：改动涉及 ArkTS 组件/页面且设备已连接（`bash scripts/doctor.sh`）时，补跑 `bash scripts/device.sh test`；涉及 `backend/*.py` 时门禁已含 unittest 与行覆盖门禁。
4. 为新增/改动的 `core/*.ts`、`services/*.ets` 与组件交互补齐单元/流程用例，使 `core` 块覆盖 100%、`services` 行 ≥95%、gate ≥90%（`scripts/coverage.cjs` 把关）；交互路径以 `scripts/test-ui-flows.cjs` 遍历。
5. 把结果与发现沉淀到 `docs/testing/04-test-plan.md`、`docs/testing/05-release.md`、`docs/issues/10-test_record.md`、`docs/testing/13-harmony-harness.md`（及对应模块记录），证据落在 `docs/testing/validation/`（仅本地保留、不提交）。

门禁或设备失败时先修复再重跑；未通过的改动不得记为已验收。

## Commit & Pull Request Guidelines
History currently contains one `feat:` commit. Follow that prefix style with concise imperative subjects, such as `fix: preserve records after save failure`. PRs should explain behavior changes, link relevant issues, report validation and untested device scenarios, and include screenshots for UI changes.

## Security & Configuration
Never commit tokens, signing material, or local configuration. Store tokens only in Asset Store; keep them out of ordinary persistence, logs, backups, and business sync. Preserve explicit context-sharing consent, HTTPS defaults, opt-in private-network HTTP, and disabled automatic request retries.

## Documentation Navigation / 文档导航

入口：[文档总索引](docs/README.md)。阅读顺序：先确认 **08 产品范围 → 09 交互设计**，再查对应模块规格、架构与实现说明；修改后对照 **04 测试计划 → 10 问题记录 → 05 验收记录**（04/05 位于 `docs/testing/`，10 位于 `docs/issues/`）。需求和草图不代表已实现，构建或逻辑测试通过不代表设备验收通过。新增、移动或删除文档时同步所属分类索引与引用；分类结构变化时同步总索引及本导航；新增测试用例时同步对应文档。

### 每日计划文档持续维护约束

自 2026-10-04 起，后续每轮涉及每日计划的交互，都应在该轮结束前把有实质意义的内容沉淀到模块文档，不能仅更新代码或只在聊天中说明。

- 需求补充、用户反馈、约束、字段与业务规则、页面及交互决策：同步更新 `docs/modules/daily-plan/11-daily-plan-spec.md` 的对应章节，保持当前有效规格一致。
- 本轮讨论结论、决策理由、实现变更、实际验证、未验证范围与待办：按日期追加到 `docs/modules/daily-plan/12-daily-plan-implementation.md`，保留演进过程；纯讨论轮也记录结论与待定项。
- 涉及界面变化时同步对应交互稿；涉及实测问题或验收状态时同步 `docs/issues/10-test_record.md`、`docs/testing/05-release.md`；影响总体范围、设计或架构时更新对应上层文档。
- 区分用户明确要求、实施建议、待确认事项、已实现与已验证，不将讨论内容直接写成已验收结论；规则被替代时注明日期和原因。无需逐字复制聊天，不记录凭据等敏感信息。

### 五类目录与索引

`docs/README.md` 是统一入口；根目录只保留索引，具体文档按用途进入以下五类。详细文档及原型清单由各分类索引维护，避免在此重复维护全部文件。

| 分类 | 目录 / 索引 | 内容 |
|---|---|---|
| 总索引 | [docs/README.md](docs/README.md) | 目录结构、阅读路线与维护约定 |
| 设计 | [docs/design/](docs/design/README.md) | 01/08 产品需求、03 架构、07/09/14/22 视觉与交互、15/16 工程规范、原型与品牌资源 |
| 模块 | [docs/modules/](docs/modules/README.md) | `frontend/`（02/21）、`daily-plan/`（11/12）、`projects/`（17/18）、`reading/`（19/20）的规格与实施记录 |
| 计划 | [docs/plans/](docs/plans/README.md) | 06 项目推进计划、工作包与交付门槛 |
| 问题 | [docs/issues/](docs/issues/README.md) | 10 模拟器/真机问题、根因、修复与回归状态 |
| 测试 | [docs/testing/](docs/testing/README.md) | 04 测试计划、05 验收记录、13 Harness、历史验证批次导航与本地证据 |

“每日计划”属于业务模块；“测试计划”随测试体系归档。旧版本资料放在对应分类的 `history/<版本>/`；07 视觉规范仍被当前版本继承，保留在设计目录。

### 验证证据

证据统一落在 `docs/testing/validation/`，历史批次清单见 [测试索引](docs/testing/README.md)。自 2026-10-09 起该目录仅保留本地，禁止提交或使用 `git add -f` 上传；历史路径 `docs/validation/` 同样忽略。证据链接仅用于本地导航，新克隆中可能不可用；可提交结论保留在 [05 验收记录](docs/testing/05-release.md)、[10 问题记录](docs/issues/10-test_record.md) 及对应模块记录中。历史批次结果不自动代表当前版本全部通过。

### Agent 技能

`.dsh/skills/` 下的技能由 DSH 以项目根最高优先级自动发现（改动即时生效，无需重启）：

| 技能 | 何时生效 |
|---|---|
| `harmonyos-arkts` | 编写/修改 ArkTS、ArkUI 代码：语言约束、`@throws` 处理规则、状态管理、资源与主题、安全红线 |
| `harmonyos-harness` | 构建、验证、设备验收：`doctor`/`verify`/`device` 用法与边界、证据约定、三层测试取舍、已知限制与真机预留 |

### 历史文档 · V0.2

历史文档已按用途归入 [设计历史](docs/design/README.md#历史设计--v02)、[计划历史](docs/plans/README.md)、[测试历史](docs/testing/README.md#历史测试--v02)。仅用于追溯旧开发预览，不作为当前 V1.0 范围依据。

### 独立业务服务本地预览（2026-10-07）

- [业务服务运行与协议](backend/README.md)：Python/SQLite 服务、独立凭据、回环启动、接口与限制。
- [架构实施状态](docs/design/03-architecture.md#13-a2-本地实施--2026-10-07)：本地共享基础已实现与完整 V1.0 尚待接入范围。
- `node scripts/test-business.cjs` 和 `python3 -m unittest discover -s backend/tests -v` 已纳入 `scripts/verify.sh`；规范门禁、门禁自测、资源检查、ArkTS 覆盖率与后端覆盖率加入后完整15阶段，逻辑快速路径11阶段。Python要求3.10+，服务启动支持macOS/Linux，HTTP测试需要回环监听权限。

- [业务预览交互稿](docs/design/business-preview.html)：独立副本连接、冲突、发送与恢复流程。
- 本地架构验证：[最终结果](docs/testing/validation/2026-10-07-architecture-v1-verified/results.txt)、[摘要](docs/testing/validation/2026-10-07-architecture-v1-verified/summary.json)、[环境](docs/testing/validation/2026-10-07-architecture-v1-verified/doctor.json)。迭代：[首次诊断](docs/testing/validation/2026-10-07-architecture-v1/results.txt)、[首轮通过](docs/testing/validation/2026-10-07-architecture-v1-final/results.txt)、[存储保护回归](docs/testing/validation/2026-10-07-architecture-v1-complete/results.txt)。设备安装：[超时重试](docs/testing/validation/2026-10-07-architecture-v1-device/install-retry.txt)、[传输诊断](docs/testing/validation/2026-10-07-architecture-v1-device/transport-diagnostic.txt)、[分步安装](docs/testing/validation/2026-10-07-architecture-v1-device/manual-install.txt)。
- 真实 Hermes 本机联调 · 2026-10-07：[脱敏摘要](docs/testing/validation/2026-10-07-hermes-live/results.txt)、[结构化结果](docs/testing/validation/2026-10-07-hermes-live/results.json)。覆盖真实原生会话与业务账本恢复，不代表手机网络、上游重启或工具执行已验收。
- HAP部署恢复 · 2026-10-07：[重连](docs/testing/validation/2026-10-07-deploy-recovery/reconnect.txt)、[文件传输](docs/testing/validation/2026-10-07-deploy-recovery/transport-restored.txt)、[安装](docs/testing/validation/2026-10-07-deploy-recovery/install.txt)、[启动](docs/testing/validation/2026-10-07-deploy-recovery/launch.txt)、[设备回归6/6](docs/testing/validation/2026-10-07-deploy-recovery/device-test.txt)。问题9已恢复，底层单一根因未确定。


### 当前分支实施范围 · 2026-10-11

用户已授权 `dev` 实施V2前端；界面以14及“前端设计&交互逻辑设计”会话为依据，沿用08与模块规格的业务、安全和数据规则。旧记录中的“仅设计/暂不实现V2”为历史状态。当前验证与限制见21；模拟点击20组，设备12项，证据仍仅本地保留。
