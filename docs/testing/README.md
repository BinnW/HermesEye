# 测试与验收索引

[返回文档总索引](../README.md)。本类保存测试计划、验收结论、Harness 说明和本地证据导航。问题现象与修复分析独立归入 [问题目录](../issues/README.md)。

## 当前文档

| 文档 | 用途 |
|---|---|
| [04 · 测试与验收计划](04-test-plan.md) | 测试层次、命令、覆盖率、流程用例与设备验收矩阵 |
| [05 · 重构与验收记录](05-release.md) | 已执行验证、交付范围、限制与发布阻塞 |
| [13 · 鸿蒙开发 Harness 能力清单](13-harmony-harness.md) | doctor / verify / device 的入口、能力与维护边界 |
| [验证证据目录](validation/) | 本地 results.txt、summary.json、阶段日志、设备 transcript 与截图；目录存在不等于当前版本通过 |

## 历史测试 · V0.2

| 文档 | 用途 |
|---|---|
| [历史 04 · 测试与验收计划](history/V0.2/04-test-plan.md) | 旧开发预览验收矩阵 |
| [历史 05 · 开发预览发布报告](history/V0.2/05-release.md) | v0.1.0 自测、发布门槛与限制 |

## 验证证据

证据统一落在 `docs/testing/validation/`。自2026-10-09起，该目录仅保留本地，禁止提交或使用 `git add -f` 上传；历史路径 `docs/validation/` 同样忽略。下方证据链接是本地导航，在GitHub或新克隆中不可用；可提交的验证结论保留在05、10等文档中。以下文件记录指定批次的结果，不自动代表当前版本全部通过；结论与未测范围以 05、10 及模块交付记录为准。

| 批次 | 结果与截图 |
|---|---|
| V2 前端 · 2026-10-11 | [15/15门禁](validation/2026-10-11-v2-release-ready/results.txt)、[设备12/12](validation/2026-10-11-v2-release-device/device-test.txt)；实施映射和边界见21，证据仅本地 |
| V1 项目/阅读 · 2026-10-11 | [14/14 门禁](validation/2026-10-11-v1-project-reading-final/results.txt)、[覆盖率](validation/2026-10-11-v1-project-reading-final/coverage.json)、[最终设备回归](validation/2026-10-11-v1-project-reading-device-final/device-test.txt)；实际结果及边界见05，仅本地证据 |
| V1.0 基线 | [自动验证摘录](validation/V1.0/automated-results.txt)、[Hypium 结果](validation/V1.0/hypium-result.txt) |
| 键盘修复 · 2026-10-02 | [设备测试](validation/keyboard-2026-10-02/device-tests.txt)、[Previewer 测试](validation/keyboard-2026-10-02/previewer-tests.txt)、[键盘展开截图](validation/keyboard-2026-10-02/keyboard-open.png)、[键盘滚动截图](validation/keyboard-2026-10-02/keyboard-scroll.png) |
| 测试重设计 · 2026-10-03 | [测试结果](validation/test-redesign-2026-10-03/results.txt) |
| 问题 1–5 回归 · 2026-10-03 | [测试结果](validation/issues-1-5-tests-2026-10-03/results.txt) |
| 每日计划 · 2026-10-03 | [验证结果](validation/daily-plan-2026-10-03/results.txt)、[Previewer 结果](validation/daily-plan-2026-10-03/previewer.txt) |
| Harness 构建/验证 · 2026-10-04 | [验证结果](validation/2026-10-04-final/results.txt)、[摘要](validation/2026-10-04-final/summary.json)（7/7 阶段通过；含 21 条 ArkTS 告警基线，见 [10](../issues/10-test_record.md) 问题8） |
| 模拟器设备验收 · 2026-10-04 | [设备测试](validation/2026-10-04-device/device-test.txt)（4/4 通过）、[hilog（gzip 压缩）](validation/2026-10-04-device/hilog.txt.gz) |
| 崩溃日志排查 · 2026-10-05 | [faultlog 索引](validation/2026-10-05-device/faultlog/index.txt)（2 条 2026-10-01 历史 jscrash，当前构建未复现，根因未定位）、[应用日志](validation/2026-10-05-device/hilog.txt) |
| 编码/日志规范门禁 · 2026-10-07 | [10/10 阶段结果](validation/2026-10-07-coding-standards/results.txt)、[机读规范报告](validation/2026-10-07-coding-standards/standards.json)、[摘要](validation/2026-10-07-coding-standards/summary.json)（0 error / 14 存量 warning，ArkTS 零告警） |
| 测试重构建与覆盖率 · 2026-10-07 | [最终 13/13 阶段结果](validation/2026-10-07-final-test-rebuild/results.txt)、[覆盖率报告](validation/2026-10-07-final-test-rebuild/coverage.json)（core 100%/100%，services 99.6%/99.3%）、[摘要](validation/2026-10-07-final-test-rebuild/summary.json) |
| 模拟点击设备验收 · 2026-10-07 | [设备 8/8](validation/2026-10-07-click-flows-device/device-test.txt)（模拟器 API 26，含 U08/U09）、[问题11诊断留档](validation/2026-10-07-click-flows-diag3/device-test.txt) |
| 测试文档归集 · 2026-10-07 | [归集后 13/13 阶段结果](validation/2026-10-07-docs-restructure/results.txt)（证据改落 `docs/testing/validation/`，链接与导航审计通过） |
| 项目模块用例补充 · 2026-10-09 | [14/14 阶段结果](validation/2026-10-09-project-module-tests/results.txt)、[覆盖率](validation/2026-10-09-project-module-tests/coverage.json)（core 100%/100%）、[设备 10/10](validation/2026-10-09-project-module-device/device-test.txt)（证据目录仅本地保留，不提交） |
| 工作区未提交改动测试 · 2026-10-17 | [15/15 门禁](validation/2026-10-17-workspace-test/results.txt)、[覆盖率](validation/2026-10-17-workspace-test/coverage.json)（core 100%、services 99.6%、组件切片 100%）、[设备 12/12](validation/2026-10-17-workspace-device/device-test.txt)（修复 8 个用例漂移后通过；仅本地保留） |
| V2 联调与外部能力 · 2026-10-11 | [15/15 门禁](validation/2026-10-11-v2-baseline/results.txt)、[设备 12/12](validation/2026-10-11-v2-device-final/device-test.txt)、[日历读取 2 条日程](validation/2026-10-11-calendar-probe/device-test.txt)、[真实 Hermes 往返通过](validation/2026-10-11-hermes-live-v2)（运动健康未接入；仅本地保留） |
| 阅读/业务用例补充 · 2026-10-11 | [15/15 阶段结果](validation/2026-10-11-reading-tests/results.txt)、[ArkTS 覆盖率](validation/2026-10-11-reading-tests/coverage.json)（core/组件 100%，services 99.6%/99.3%）、[后端覆盖 100%](validation/2026-10-11-reading-tests/backend-coverage.json)、[设备 12/12](validation/2026-10-11-reading-tests-device/device-test.txt)（仅本地保留） |

问题8追加验证（2026-10-06）：[最终零告警结果](validation/2026-10-06-issue8-final/results.txt)、[摘要](validation/2026-10-06-issue8-final/summary.json)、[设备回归](validation/2026-10-06-issue8-device/device-test.txt)。迭代留档：[先行逻辑回归](validation/2026-10-06-issue8-logic/results.txt)、[首次编译诊断](validation/2026-10-06-issue8/results.txt)。实际覆盖及未测范围见 05、10。
