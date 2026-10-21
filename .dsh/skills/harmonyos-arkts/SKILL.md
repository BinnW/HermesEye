---
name: harmonyos-arkts
description: 在本仓库编写或修改 ArkTS/ArkUI 代码时使用：覆盖会让编译失败的 ArkTS 语言约束、本项目的 @throws 处理规则、ArkUI V1 状态管理约定、资源与主题规则，以及 code-linter.json5 约束的安全红线。
whenToUse: 需要新增或修改 entry/src/main/ets 下的 .ets/.ts 文件、新增页面或组件、接入新的 HarmonyOS 系统能力、处理 ArkTS 编译器告警、或不确定某段代码是否符合鸿蒙工程规范时。
---

# 在 HermesEye 中写 ArkTS / ArkUI

## 先确认真实约束，不要凭印象

```bash
bash scripts/doctor.sh          # 打印 DevEco 安装位置、SDK API、工程 compatibleSdkVersion
```

- 工程目标：HarmonyOS **6.1.1(API 24)**（`build-profile.json5` 的 `compatibleSdkVersion`/`targetSdkVersion`）。
- 开发机装的 SDK 可能更新（例如 API 26）。**编译通过不等于目标 API 可用**：调用某个 API 前先确认它的 `@since` 不高于工程目标 API，否则在低版本设备上会运行期失败。
- SDK 类型定义在 `$DEVECO_HOME/sdk/default/openharmony/ets/api/`，`$DEVECO_HOME` 由 `scripts/lib/deveco-env.sh` 解析。查 API 签名直接读 `.d.ts`，不要猜。

## 分层是硬约束，不是风格建议

| 目录 | 允许的内容 | 理由 |
|---|---|---|
| `entry/src/main/ets/core/` | 纯规则：实体、校验、迁移、状态计算 | 三套 Node 用例直接 import 这些源码并在无设备环境下断言 |
| `entry/src/main/ets/services/` | 平台适配：文件、网络、Asset Store、通知、日历、窗口 | 平台 API 集中在此，可被注入 mock 替换 |
| `entry/src/main/ets/pages/`、`components/` | ArkUI 界面与页面状态 | 只有这里可以出现 ArkUI 装饰器 |

**把 `@ohos.*` / `@kit.*` 的 import 写进 `core/` 会直接破坏 harness**：`scripts/test-domain.cjs`、`test-services.cjs`、`test-workspace.cjs` 用 DevEco 自带的 typescript 在内存里转译 `core/` 并在 Node VM 里执行，没有 ArkTS 运行时，这类 import 会抛 `Unexpected import`。新增平台能力一律放 `services/`，`core/` 只留可移植规则。

## 规则一：每个 `@throws` 调用都要处理

这是本项目当前**唯一成规模的编译器告警**：基线 21 条，全部是同一句话。

```
ArkTS:WARN File: .../services/CredentialStore.ets:32:17
 Function may throw exceptions. Special handling is required.
```

成因：HarmonyOS SDK 的声明文件里，会抛异常的 API 带 `@throws { BusinessError } <code> - <说明>` 标注（SDK 中 **292 个 `.d.ts`** 使用该标注）。ArkTS 编译器要求调用点必须处于 `try/catch` 中，否则每个调用点报一条 `WARN`。

对照实例 —— 同一个文件里两处已处理、一处漏掉：

```ts
// CredentialStore.ets
try { await asset.add(attributes); } catch { throw new Error('安全存储失败，配置未保存；不会降级为明文存储'); }   // 已处理
try { ... } catch { throw new Error('安全凭据暂不可用，请解锁设备或重新填写 Token'); }                        // 已处理
await asset.remove(query);                                                                                // 漏掉 -> 告警
```

修复要点：

1. **按错误码处理，不要裸吞**。`@throws` 注释里带着具体 `BusinessError.code`，读 `.d.ts` 拿到它，在 `catch (error)` 里判断 `(error as BusinessError).code`，再决定是降级、重试还是转成用户可读文案。
2. **不要把失败静默降级成成功**。本项目的既有约定是失败必须显式暴露（例如凭据不可用时不回退明文存储），保持一致。
3. 在 `catch` 中重新抛出的错误要保留可诊断信息，不要 `catch {}` 后什么都不做。
4. 排查其他告警点时注意：`fileIo.*Sync`、`window.getLastWindow`、`abilityAccessCtrl.*`、`calendarManager.*`、`notificationManager.*`、`promptAction.showToast`、`setColorMode` 都在此列。

查看当前告警清单：

```bash
bash scripts/verify.sh --label arkts-audit      # evidence 目录里 grep 'ArkTS:WARN'
```

## ArkTS 语言约束（会真实挡住编译的）

- 禁 `any` / `unknown`。外部数据用 `interface` 或 `class` 声明形状后再断言。
- 对象字面量必须有明确类型；不能写匿名对象类型。先定义 `interface`，再 `const x: MyShape = { ... }`。
- 不支持 `Function` 类型，写完整签名：`(value: string) => void`。
- 类字段必须初始化（或声明可空 / 用 `!`）。`@State` 字段一律给初值。
- 索引签名不能用于类实例；键值集合用 `Map`（本仓库 `asset.AssetMap`、工作区数据都是这个模式）。
- 不用 `namespace`、`require`、`eval`、原型改写；模块只用 `import`/`export`。
- 类型断言只用于相关类型之间；`as` 一个无关类型会被拒绝。
- 跨线程（TaskPool/Worker）传递的对象必须满足 `@Sendable` 约束，普通类不能直接跨线程。

## ArkUI 约定（本仓库使用状态管理 V1）

入口是 `@Entry @Component struct Index`（`pages/Index.ets`），页面状态集中在 `Index` 的 `@State` 字段上，子组件通过参数与回调通信。

- `@State` 必须初始化；`@Link`/`@Prop` 必须由父组件传入，不要试图在子组件里 new。
- `build()` 必须**单根节点**；`if`/`ForEach` 不能出现在 build 的最外层。
- 列表用 `ForEach` 时必须提供稳定的 key 生成函数（用 `newId()` 生成的 id，不要用数组下标），否则增删会错位复用组件。
- 长列表用 `LazyForEach` + `IDataSource`，不要用 `ForEach` 直接渲染大数据集。
- 不要在 `build()` 里做计算、拼字符串或创建对象；提前在方法里算好存进字段。
- 组件文件名用 PascalCase，与 `struct` 名一致；共享组件放 `components/`。
- 主题色只用语义色资源（`$r('app.color.xxx')`），同时补 `resources/base/element/color.json` 与 `resources/dark/element/color.json`；不要写死十六进制颜色。
- 面向用户的文案保留中文，放 `resources/base/element/string.json`，代码里用 `$r('app.string.xxx')`。

## 安全红线（`code-linter.json5` 会以 error 拦截）

已启用的安全规则：`no-unsafe-aes` / `no-unsafe-hash` / `no-unsafe-dh` / `no-unsafe-dsa` / `no-unsafe-ecdsa` / `no-unsafe-rsa-encrypt` / `no-unsafe-rsa-sign` / `no-unsafe-rsa-key` / `no-unsafe-dsa-key` / `no-unsafe-dh-key` / `no-unsafe-3des`（`no-unsafe-mac` 为 warn）。

含义：**不要手写或引入弱算法**。哈希用 SHA-256 及以上；对称加密用 AES-GCM；非对称用 RSA-OAEP / ECDSA 且密钥长度达标；禁用 MD5、SHA-1、DES/3DES、ECB。

Token 等凭据只进 Asset Store（`services/CredentialStore.ets` 的模式：`asset.add` + 不可变 alias 引用）。绝不写入 Preferences、文件、日志、备份或业务同步数据。任何安全存储失败都必须让保存整体失败，不得降级为明文。

## 收尾检查

1. `bash scripts/verify.sh --label <你的改动名>` —— 必须 7/7 通过。
2. 变化前后对比 ArkTS 告警数；**不要增加**。处理过的 `@throws` 调用要让计数下降。
3. 改了 `core/` 就在对应 Node 套件里加行为用例；改了 ArkUI 就同步 `docs/design/09-frontend-design-V1.0.md` 与交互稿。
4. 明确区分「编译通过」「逻辑用例通过」「设备验收通过」——三者互不替代。
