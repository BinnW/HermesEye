# HermesEye 文档索引

文档按 **设计、模块、计划、问题、测试** 五类组织。本页是统一入口；分类索引列出具体文档、原型与历史资料。现有文档编号保留，便于追溯旧记录。

## 目录与归档规则

```text
docs/
├── README.md                  # 总索引与阅读路线
├── design/                    # 产品需求、交互/视觉、架构、工程规范与原型
│   ├── README.md
│   └── history/V0.2/          # 历史需求、设计与架构
├── modules/                   # 按功能组织规格、实施与交付记录
│   ├── README.md
│   ├── frontend/             # 前端整体实现
│   ├── daily-plan/           # 每日计划
│   ├── projects/             # 项目
│   └── reading/              # 阅读
├── plans/                     # 项目推进计划、工作包与待办
│   ├── README.md
│   └── history/V0.2/
├── issues/                    # 问题现象、根因、修复与回归记录
│   └── README.md
└── testing/                   # 测试计划、验收结论、Harness 与验证证据
    ├── README.md
    ├── history/V0.2/
    └── validation/            # 仅本地保留，禁止提交
```

| 分类 | 入口 | 放什么 |
|---|---|---|
| 设计 | [设计索引](design/README.md) | 产品范围、页面与交互、视觉资源、系统架构、编码和日志规范 |
| 模块 | [模块索引](modules/README.md) | 每个功能的有效规格、实现过程、决策理由与交付边界 |
| 计划 | [计划索引](plans/README.md) | 项目级工作包、推进顺序、完成门槛和待联调事项 |
| 问题 | [问题索引](issues/README.md) | 实测现象、原因分析、修复方案与回归状态 |
| 测试 | [测试索引](testing/README.md) | 测试与验收计划、实际验证结果、测试工具和本地证据导航 |

“每日计划”是业务模块，放在 `modules/daily-plan/`；“测试计划”随测试体系放在 `testing/`；`plans/` 专门存放项目推进计划。旧版本资料放在所属分类的 `history/<版本>/`，不与当前有效规则混用。

## 阅读路线

1. **了解范围与设计**：[08 产品范围](design/08-product-requirements-V1.0.md) → [09 前端基础规则](design/09-frontend-design-V1.0.md) → [14 V2.0](design/14-frontend-design-V2.0.md) / [22 V2.1](design/22-frontend-design-V2.1.md)。
2. **开发功能**：[对应模块](modules/README.md) → [03 架构边界](design/03-architecture.md) → [15 编码规范](design/15-coding-standard.md) / [16 日志规范](design/16-logging-standard.md)。
3. **安排下一步**：[06 推进与交付清单](plans/06-project-plan.md)，结合模块实施记录中的待办。
4. **排查与验收**：[04 测试计划](testing/04-test-plan.md) → [10 问题记录](issues/10-test_record.md) → [05 验收记录](testing/05-release.md)；命令及能力边界查 [13 Harness](testing/13-harmony-harness.md)。

当前业务范围沿用 V1.0；`dev` 的 V2 前端实施授权与验证见 [21 实施记录](modules/frontend/21-frontend-v2-implementation.md)。需求、草图、已实现、已验证是不同状态；构建或逻辑测试通过不能替代设备与真实服务验收。历史段落中的“仅设计”等限制按其日期理解，后续明确决策优先。

## 维护约定

- `docs/` 根目录只保留本索引；新增文档按用途进入五类目录，模块资料按功能归组。
- 新增、移动、删除文档时同步所属分类索引与相关引用；分类结构变化时同步本页及 [AGENTS.md](../AGENTS.md)。
- 当前规格保持一致；演进过程按日期写入模块实施记录；实测问题与验证结论分别更新问题、测试文档。
- `testing/validation/` 及旧证据路径 `docs/validation/` 都是本地忽略目录，禁止提交或使用 `git add -f` 上传。新克隆中没有这些文件是预期状态，可提交结论仍需写入验收及问题记录。
- 2026-10-21 完成五类归档：原文档编号、原型资源路径、历史结论及本地证据位置保留；本次整理不产生新的产品验收结论。
