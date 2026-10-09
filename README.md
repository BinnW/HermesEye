# HermesEye

面向鸿蒙的个人事务统一入口：连接自行部署的 Hermes，把每日计划、项目、阅读和需求会话放在同一个工作台。Hermes 作为个人学习与效率提升的助手，提供贾维斯式能力支持。

## V1.0 依据
- [痛点与产品需求](docs/08-product-requirements-V1.0.md)
- [已确认的前端设计](docs/09-frontend-design-V1.0.md)
- [需求与实现索引](docs/01-product-requirements.md)
- [页面实现说明](docs/02-design.md)
- [架构与接口边界](docs/03-architecture.md)
- [测试计划](docs/testing/04-test-plan.md) / [实际验收记录](docs/05-release.md)
- [交付进度与待核验项](docs/06-project-plan.md)

导航：今日 / 项目 / 阅读 / 我的。所有对话归属需求；单纯记录可先存入收件箱。支持本机项目与计划、独立会话、安全连接配置、主题持久化和旧数据迁移。

**当前为 V1.0 客户端重构中的开发版本，尚未完成整个 V1.0。** 服务端会话持久化、业务同步、微信读书/IMA、健康数据、双 Vault、多 Agent、部署和周期强提醒仍待协议接入或策略确认，均保留在 V1.0 范围内。

## V2.0 前端预研

V2.0 卡片化提前设计见 [前端设计 V2.0](docs/14-frontend-design-V2.0.md) 和 [全页面可视稿](docs/design/V2.0/index.html)。当前为待确认设计，未修改应用实现，不改变 V1.0 交付范围。

## 开发与验证

ArkTS / ArkUI / Stage，HarmonyOS 6.1.1（API 24）。macOS 安装 DevEco Studio 后：

```sh
bash scripts/test-deveco.sh
```

脚本使用 DevEco Node 执行三套逻辑测试，编译 Debug 主包和设备测试包，并通过 Previewer 执行 Hypium 本机测试。安装路径可用 `DEVECO_HOME` 覆盖。设备测试需另外连接设备、配置签名并安装运行；脚本不将编译视为设备通过。

Windows 构建保留 `scripts/build.ps1 -Mode debug`，可传 `-DevEcoHome`；Node 测试额外运行 `scripts/test-workspace.cjs`。未配置签名时生成 unsigned HAP。

Token 使用系统 Asset Store，禁止放入仓库、普通配置或日志。真实凭据只在应用本机填写。历史开发预览文档保存在 `docs/history/V0.2/`，旧发布包在 `releases/v0.1.0/`，与当前改写版本区分。

## 每日计划模块 · 2026-10-03

已实现按日查看、编辑/改期、重要性与预计用时、状态筛选、日历选日导入与占用统计、带依据的历史建议采纳、移除保留会话。详见 [模块规格与交互设计](docs/modules/11-daily-plan-spec.md)、[开发与验证记录](docs/modules/12-daily-plan-implementation.md)、[交互设计稿](docs/design/daily-plan/index.html)。远端 AI、同步与锁屏强提醒尚待接入。


## 独立业务服务本地预览

“我的 → 独立业务服务（本地预览）”接入本仓库 Python/SQLite 服务，支持独立业务副本、计划同步/冲突以及持久会话操作查询。启动、凭据与接口见 [backend/README.md](backend/README.md)。旧工作区不自动迁移；完整 V1.0 未完成项见 [架构第13节](docs/03-architecture.md)。`scripts/verify.sh` 已纳入客户端与服务端测试，需要 Python 3.10+ 和回环监听权限。
