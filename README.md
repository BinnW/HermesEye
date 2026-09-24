# HermesEye

鸿蒙原生个人秘书入口：连接自己的 Hermes，整理个人记录、授权系统数据和提醒。

## 项目资料
1. [产品需求](docs/01-product-requirements.md)
2. [视觉与交互](docs/02-design.md)
3. [架构与接口边界](docs/03-architecture.md)
4. [测试计划](docs/04-test-plan.md)
5. [自测与发布状态](docs/05-release.md)
6. [项目里程碑与后续计划](docs/06-project-plan.md)

本机逻辑自测：使用 DevEco 内置 Node 执行 `scripts/test-domain.cjs` 和 `scripts/test-services.cjs`。
构建：PowerShell 执行 `scripts/build.ps1 -Mode release`；未配置签名时输出 unsigned HAP。

技术栈：ArkTS / ArkUI / Stage，现有 SDK HarmonyOS 6.1.1 (API 24)。当前是开发预览里程碑；真实 Hermes、真机和签名发行需完成集成验收。
