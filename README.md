# HermesEye

面向 HarmonyOS 的个人事务工作台，将每日计划、项目推进、阅读与需求会话集中在手机端，通过连接自行部署的 Hermes，辅助学习、思考与执行。

[文档索引](docs/README.md) · [产品需求](docs/design/08-product-requirements-V1.0.md) · [实施记录](docs/modules/frontend/21-frontend-v2-implementation.md) · [验收与限制](docs/testing/05-release.md)

## 当前状态

**开发预览，完整 V1.0 尚未完成。** 当前工作区已实现 V2.0 / V2.1 前端，包括卡片布局、悬浮导航、左右会话、今日单屏和粘性页头；业务范围继续沿用 V1.0。

本页于 2026-10-22 按现有实现与交付记录整理。已执行的构建、模拟器回归及本机 Hermes 联调按批次记录在 [验收文档](docs/testing/05-release.md)，不代表当前工作区或所有端到端场景均已验收。

## 功能概览

应用提供「今日 / 项目 / 阅读 / 我的」四个入口。会话归属具体需求，可从事项、项目或阅读疑问继续讨论；独立需求用于承接暂未归入项目的想法。

| 入口 | 当前实现 |
|---|---|
| 今日 | 按日期查看、创建和调整事项，完成状态与筛选、进度展示、日历导入；记录、历史建议、日报汇总和提醒入口收纳在工具菜单 |
| 项目 | 项目搜索与状态筛选、目标与完成标准、里程碑、复盘、暂停/完成/归档，以及项目关联需求会话 |
| 阅读 | 业务服务提供的书籍进度与来源副本、采集和整理状态、周期配置、引用原文提问及回答恢复 |
| 我的 | Agent 连接、数据来源与授权、知识空间、提醒与报告、显示模式与材质配置 |

本地工作区支持按服务器隔离、持久化和旧数据迁移；保存失败保留输入，网络或执行结果未知时明确显示状态。前端提供深浅色主题及实色材质选项，视觉与交互说明见 [前端设计 V2.1](docs/design/22-frontend-design-V2.1.md)。

### 外部能力的交付边界

- **Hermes 与业务同步**：已有原生会话适配、独立业务副本、修订冲突和操作账本恢复；本机真实往返有验证记录。手机网络、上游重启、工具执行及完整跨端链路仍需专项验收。
- **阅读来源**：微信读书来源适配、周期整理和疑问交互已实现；真实来源采集、长期周期运行及家庭部署仍待验证。当前阅读流程不写入 IMA。
- **后续能力**：AI 计划建议、固定模板自动日报、周期强提醒、运动健康接入、双 Vault 权限与写入、多 Agent 构建和部署尚未完整交付。配置入口或数据模型存在不等于外部能力可用。

各模块的有效规则与未测范围见 [模块文档](docs/modules/README.md)，推进事项见 [项目计划](docs/plans/README.md)。

## 技术与工程结构

客户端使用 **ArkTS / ArkUI / Stage 模型**，目标为 **HarmonyOS 6.1.1（API 24）**。领域规则放在 `core/`，网络、持久化与系统能力适配放在 `services/`，页面和共享组件负责交互。

可选的独立业务服务使用 **Python 3.10+ / SQLite**，管理业务对象、修订、会话关联与执行回执，再通过适配器调用 Hermes；无需修改官方 Hermes。服务端运行方式与协议见 [backend/README.md](backend/README.md)，系统边界见 [架构文档](docs/design/03-architecture.md)。

```text
HermesEye/
├── AppScope/                   # 应用配置与资源
├── entry/src/main/ets/
│   ├── pages/                  # 页面状态与导航
│   ├── components/             # 共享 UI 与模块面板
│   ├── core/                   # 领域模型、校验与迁移
│   └── services/               # 网络、存储与系统适配
├── entry/src/main/resources/   # 文案、主题与视觉资源
├── entry/src/test/             # 本地 Hypium 测试
├── entry/src/ohosTest/          # 模拟器 / 真机测试
├── backend/                    # 独立业务服务及 Python 测试
├── scripts/                    # 环境检查、构建、逻辑与设备验证
├── docs/                       # 设计、模块、计划、问题、测试
└── releases/                   # 历史发布产物
```

## 开始开发

### 环境准备

1. 安装 DevEco Studio 和匹配工程目标的 HarmonyOS SDK，用 IDE 打开仓库根目录并完成依赖同步。
2. 准备 Python 3.10+，完整验证需要 SQLite 和本机回环监听权限；业务服务无需第三方 Python 依赖。
3. 使用兼容的模拟器或设备运行 `entry`。真机需配置有效签名；签名材料与本地配置不提交到仓库。

以下命令均从仓库根目录执行。macOS 开发推荐先检查环境，再运行完整验证：

```bash
bash scripts/doctor.sh
bash scripts/verify.sh --deny-arkts-warnings --label local-check
```

脚本自动查找 DevEco 安装；非默认路径可通过 `DEVECO_HOME` 指定。Node 逻辑测试使用 DevEco 提供的 TypeScript 工具链；直接执行 `node` 命令时，需将可用的 Node.js（可使用 DevEco 内置版本）加入 `PATH`。

### 验证与运行

| 任务 | 命令 |
|---|---|
| 快速逻辑验证，跳过 HAP 编译与本地 Hypium | `bash scripts/verify.sh --skip-build --label logic-check` |
| 编码与日志规范检查 | `node scripts/check-standards.cjs` |
| 查询模拟器 / 设备 | `bash scripts/device.sh status` |
| 安装已构建的开发包 | `bash scripts/device.sh install` |
| 启动应用 | `bash scripts/device.sh launch` |
| 执行设备 Hypium 回归 | `bash scripts/device.sh test` |
| 采集应用日志 | `bash scripts/device.sh log --app` |

完整 `verify.sh` 包含规范及自测、资源、覆盖率、生产逻辑与交互流程、Python 后端测试、主包和测试包编译、本地 Hypium。它不安装应用，也不代替设备权限、提醒或真实服务验收。设备操作前需完成构建；多个目标连接时使用 `--target <serial>`。当前 `device.sh` 安装路径面向 unsigned 开发包，真机与已有签名安装需按 [Harness 说明](docs/testing/13-harmony-harness.md) 配置匹配的签名与部署流程。

Windows 可通过 DevEco Studio 构建运行，也保留 PowerShell 构建入口：

```powershell
./scripts/build.ps1 -Mode debug
./scripts/build.ps1 -Mode release
```

安装路径通过 `-DevEcoHome` 指定；未配置签名时产物为 unsigned。构建脚本不等同于完整验证门禁。

### 可选：启动独立业务服务

先在进程环境中设置独立随机业务凭据 `HERMES_EYE_TOKEN`（至少 32 字符），再启动：

```bash
python3 backend/server.py
```

服务启动器支持 macOS / Linux，默认监听 `127.0.0.1:8787`，数据写入本地忽略目录 `backend/.local/`。未配置上游时可使用业务同步，会话与运行能力不可用；连接 Hermes 需另设 `HERMES_ROOT` 和 `HERMES_TOKEN`，阅读来源需设置 `WEREAD_API_KEY`。具体配置见 [业务服务文档](backend/README.md)。

应用入口为「我的 → Agent 连接 → 独立业务服务（本地预览）」。该预览使用独立副本，不自动迁移或上传原工作区；手机访问主机回环服务需另行配置安全转发或反向代理。

## 文档导航

[docs/README.md](docs/README.md) 是总索引，文档按用途分为五类：

| 分类 | 内容 |
|---|---|
| [设计](docs/design/README.md) | 产品需求、视觉与交互、系统架构、编码和日志规范、原型资源 |
| [模块](docs/modules/README.md) | 前端整体、每日计划、项目、阅读的规格与实施记录 |
| [计划](docs/plans/README.md) | 项目推进顺序、工作包和交付门槛 |
| [问题](docs/issues/README.md) | 实测问题、根因、修复与回归状态 |
| [测试](docs/testing/README.md) | 测试计划、验收记录、Harness 说明与本地证据导航 |

首次了解项目可先读 [产品需求](docs/design/08-product-requirements-V1.0.md)，开发前查看对应模块、[编码规范](docs/design/15-coding-standard.md)、[日志规范](docs/design/16-logging-standard.md) 和 [仓库协作约定](AGENTS.md)。历史版本文档保存在所属分类的 `history/` 下；[v0.1.0 发布目录](releases/v0.1.0/README.md) 为历史开发预览，不代表当前版本产物。

## 数据与凭据

Agent 连接凭据使用系统 Asset Store；独立业务预览的凭据仅在本次连接中保留于内存。上游和来源凭据由业务服务进程环境提供，不写入客户端副本、普通配置或日志。默认使用 HTTPS，私网 HTTP 需显式启用；分享上下文前明确选择来源与范围，业务请求不自动重试。

验证证据保存在 `docs/testing/validation/`，仅留本地，禁止提交；新克隆中缺少这些日志或截图是预期状态。可公开追溯的验证结论保留在测试、问题及模块记录中。
