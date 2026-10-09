---
name: harmonyos-harness
description: 在本仓库构建、验证或做设备验收时使用：doctor/verify/device 三条命令的用法与边界、证据落盘约定、三层测试的取舍、ArkTS 告警基线，以及已知的 harness 限制。
whenToUse: 需要确认改动能否编译、跑逻辑或 Hypium 用例、在模拟器或真机上安装验收、抓 hilog、判断"绿灯到底证明了什么"、或排查工具链/设备相关失败时。
---

# HermesEye 的构建、验证与设备闭环

## 三条命令，各管一段

```bash
bash scripts/doctor.sh     # 环境能不能干活？只读，不改任何东西
bash scripts/verify.sh     # 代码能不能编译、逻辑与本地单测过不过？不碰设备
bash scripts/device.sh     # 装到模拟器/真机上跑设备用例、抓日志
```

三者严格单向：`doctor` 排除环境问题 → `verify` 拿到编译与逻辑证据 → `device` 才做设备验收。**不要跳步**，也不要用后一步的绿灯掩盖前一步的红灯。

## `doctor.sh`：先排除环境问题

```bash
bash scripts/doctor.sh                  # 人读报告
bash scripts/doctor.sh --json out.json  # 机器可读
bash scripts/doctor.sh --strict         # 警告也返回 1，适合放进门禁
```

它检查：DevEco 安装位置、shell 与 Node 两套解析器是否指向同一安装、自带 node/java/hvigor/ohpm/hdc/emulator、SDK API 与工程 `compatibleSdkVersion` 是否匹配、`oh_modules`、三套逻辑用例是否都在、签名配置、签名材料是否已被 gitignore、当前 hdc 目标、技能目录。

**签名配置为空的 WARN 是预期状态**：模拟器接受未签名 HAP，真机不接受。见下方「真机预留」。

## `verify.sh`：唯一的验证入口

```bash
bash scripts/verify.sh                          # 全流水线，约 12 秒
bash scripts/verify.sh --skip-build             # 只跑三套逻辑用例，约 1 秒
bash scripts/verify.sh --label my-change        # 证据目录命名
bash scripts/verify.sh --deny-arkts-warnings    # 任何 ArkTS 告警都算失败
bash scripts/verify.sh --keep-going             # 失败不中断，看全部阶段
```

阶段顺序：`logic-domain` → `logic-services` → `logic-workspace` → `hap-default` → `hap-ohostest` → `hypium-local` → `hypium-result`。任一阶段失败即整体返回 1，且**默认快速失败**（后续阶段不再执行）。

证据落在 `docs/testing/validation/<日期>-<标签>/`：`results.txt`（全程摘要）、`summary.json`（阶段状态、耗时、ArkTS 告警数）、每个阶段一个 `<阶段>.log`、以及 `hypium-result.txt`。写交付结论时引用这些文件，不要只贴聊天里的输出。

`scripts/test-deveco.sh` 现在只是 `verify.sh` 的兼容别名。旧笔记里的用法仍可用，但不要在新文档里引用它。

### 绿灯证明了什么，没证明什么

| 通过 | 只说明 |
|---|---|
| 三套逻辑用例 | `core/` 里的纯规则在 Node 里行为正确；平台能力全部是注入的 mock |
| `hap-*` | ArkTS 编译通过；**未签名**，未安装，未运行 |
| `hypium-local` | 在 Previewer/本地 ArkTS 运行时下的领域行为正确 |

**都不代表**：权限授予、提醒注册、Asset Store 真实读写、日历访问、键盘避让、真实 Hermes 网络联调。这些只能由 `device.sh` 或人工验收覆盖。

## `device.sh`：模拟器与真机共用一套接口

```bash
bash scripts/device.sh status                  # 目标、机型、API、是否已安装、产物是否就绪
bash scripts/device.sh install                 # 装主包 + ohosTest 包
bash scripts/device.sh launch                  # 启动 EntryAbility 并确认进程存活
bash scripts/device.sh test                    # 跑 ohosTest，全过才返回 0
bash scripts/device.sh log --app --seconds 20  # 抓本应用进程的 hilog
bash scripts/device.sh faults                  # 拉崩溃/冻屏日志并打印 Reason 与栈顶
bash scripts/device.sh uninstall
```

通用参数：`--target <serial>`（多目标时必须指定）、`--out <dir>`、`--allow-any-target`。

实测基线：模拟器 `emulator` / API 26，主包与测试包安装成功，`launch` 后进程存活，`test` 报 `Tests run: 4, Failure: 0, Error: 0, Pass: 4`（含真实 Asset Store 用例）。

几个已踩过的坑，改脚本时别再犯：

- `hdc shell hilog -x` 里的 `-x` 会被 hdc 自己当成 hdc 选项吃掉。**远端命令必须作为单个字符串传入**：`hdc shell "hilog -T MyTag"`。
- `-x` 是"打印整个环形缓冲区后退出"，做实时抓取要用阻塞读取的 `hilog`（不加 `-x`）。
- macOS 没有 `timeout`。需要超时就用脚本内置的看门狗（`verify.sh` 的 `run_stage` 就是这么做的），不要依赖 `timeout`。
- 看门狗子 shell 必须把 stdout/stderr 重定向到 `/dev/null`，否则它的 `sleep` 会继承调用者的管道，让整条命令挂到超时结束；必须在 `wait` **之后**再拆看门狗，顺序反了会把 `sleep` 提前杀掉从而永久阻塞。

## 日志在哪里看

调试时按"要查什么"选出口，不要一上来就 `hdc shell hilog`：

| 要查什么 | 去哪 |
|---|---|
| 应用运行行为、状态流转 | `bash scripts/device.sh log --app --seconds 20` |
| 交互式排查、配合断点 | DevEco Studio → Log 窗口 → HiLog 标签 |
| 闪退、白屏、无响应 | `bash scripts/device.sh faults` |
| 开始抓取之前就发生的历史日志 | 设备 `/data/log/hilog/*.gz`，用 `hdc file recv` 拉取 |
| 编译失败、ArkTS 告警、Hypium 失败 | `docs/testing/validation/<日期>-<标签>/` 下的 `results.txt` 与各阶段 `.log` |

**抓应用日志必须带 `--app`。** 未过滤的 hilog 几乎全是系统与应用框架噪音——实测 8 秒内应用自身有效日志只有 9 行，其余几百行是 sceneboard、wifi、netmanager 等系统进程。`--app` 用 `pidof <bundle>` 解析进程号后按 `-P` 过滤，输出立即变得可读。

本工程的 domain 与 tag 是 DevEco 模板默认值（`0x0000` + `'testTag'`），**过于通用，`-D`/`-T` 无法隔离本应用**。所以：

- 排查时用 `--app`（按 pid），不要指望 `-D 0x0000`。
- 新增模块日志时别再用 `testTag`。给模块分配独立 domain 与 tag，例如 `hilog.info(0x1200, 'Workspace', ...)`，否则日志量一大就无法定位来源。
- 注意 `hilog -t app` 只区分 app/core/init 类型，**挡不住系统应用**（sceneboard 也是 app），别把它当成应用过滤。

崩溃日志格式：`/data/log/faultlog/faultlogger/<kind>-<bundle>-<uid>-<timestamp>.log`，`kind` 为 `jscrash` / `cppcrash` / `appfreeze`。`device.sh faults` 已封装拉取与摘要，默认只看本 bundle，`--all` 看全部。

已知历史故障：本 bundle 有 2 条 2026-10-01（v0.1.0）的 jscrash，`TypeError: $r is not callable, $r is undefined`，栈顶 `WorkspaceNavigation.ets:22`。当前构建重复启动未复现，**根因未定位**。注意该文件第 21–28 行在 `stateStyles` 内使用了 `$r('app.color.*')`：`stateStyles` 的函数体在不同上下文中求值，`$r` 在此处失效是已知的可疑模式，改这块时优先验证。

## 三层测试怎么选

| 要测的东西 | 放哪 | 命令 |
|---|---|---|
| `core/` 的纯规则、校验、迁移、状态计算 | `scripts/test-<suite>.cjs` 加断言 | `verify.sh --skip-build` |
| 需要真实 ArkTS 运行时但不需要设备的领域行为 | `entry/src/test/LocalUnit.test.ets`（记得注册进 `List.test.ets`） | `verify.sh` |
| 权限、Asset Store、UI、导航、键盘 | `entry/src/ohosTest/ets/test/*.test.ets`（注册进 `List.test.ets`） | `device.sh test` |

新增逻辑用例优先放 Node 套件：秒级、无设备、失败信息直接。只有确实依赖 ArkTS 运行时或系统能力时才升级到 Hypium。

## ArkTS 告警基线

`verify.sh` 会统计每个编译阶段的 `ArkTS:WARN` 条数。当前基线：`hap-default` 21 条、`hap-ohostest` 1 条，全部是 `Function may throw exceptions. Special handling is required.`（成因与修法见 `harmonyos-arkts` 技能）。

**改动不应增加这个数字。** 想确认自己有没有引入新告警：

```bash
bash scripts/verify.sh --label before && cp -r docs/testing/validation/<日期>-before /tmp/before
# 改代码
bash scripts/verify.sh --label after
diff <(grep -o 'ArkTS:WARN File:.*' /tmp/before/hap-default.log | sort) \
     <(grep -o 'ArkTS:WARN File:.*' docs/testing/validation/<日期>-after/hap-default.log | sort)
```

## 已知限制（不要重复踩）

1. **CodeLinter 没有可用的无头 CLI**。`/Applications/DevEco-Studio.app/Contents/plugins/codelinter/run/index.js` 确实是一个带 `-c/-o/-f/-e` 参数的 CLI（`-v` 报 6.0.240），但实际 lint 一律失败：`{"messageType":0,"content":"Some error occurred during linting..."}` 且 `EXIT=255`，无 stderr；换作用域（单文件/目录）、去掉 `-c`、加 `-l ets` 均无改善。它是版本锁定的 IDE 插件，未公开调用约定。**因此流水线不包含 lint 阶段**；`code-linter.json5` 的规则目前只能在 DevEco Studio 里跑。可用的替代信号是 `@throws` 等 ArkTS 编译器诊断（已纳入 `verify.sh`）。
2. **真机需要签名**。模拟器镜像是开发镜像，放宽了签名校验；真机不会。见下。
3. **没有 CI**。所有验证都在本机手动触发，证据靠 `docs/testing/validation/` 目录人工沉淀。
4. **`verify.sh` 的绿不等于设备绿**，反之亦然：两者覆盖的失败模式几乎不重叠。

## 真机预留接口

接入真机时**不需要改脚本**，只需补签名配置：

1. DevEco Studio → File → Project Structure → Signing Configs → 勾选自动签名（需登录华为开发者账号），生成 `.p12` / `.cer` / `.p7b`。
2. 把生成的 `signingConfigs` 块写进 `build-profile.json5`，把 `products[0].signingConfig` 指过去。
3. 重新 `bash scripts/verify.sh`，产物变为已签名 HAP。
4. `bash scripts/doctor.sh` 应从 WARN 转为 PASS（它会检查 `signingConfigs` 是否仍为空）。
5. 真机开 USB 调试后 `bash scripts/device.sh status`，用 `--target <serial>` 指定真机（模拟器同时在线的场景）。

`device.sh` 已内建真机保护：目标不是 `emulator` 且 `build-profile.json5` 没有签名配置时，`install`/`test` 会**直接失败并给出配置指引**，而不是让你拿到一个含义不明的安装错误。确实要试就加 `--allow-any-target`。

签名材料受 `.gitignore` 保护（`*.p12` / `*.cer` / `*.p7b` / `*.pem` 等）。**永远不要提交签名材料或把它贴进对话。** 新增签名相关文件类型时，先确认 `.gitignore` 覆盖，`doctor.sh --strict` 会把漏网当成失败。

## 工具链解析

`scripts/lib/deveco-env.sh`（shell）与 `scripts/lib/deveco-env.cjs`（Node）是定位 DevEco 的唯一来源，两边的候选列表必须一致；`doctor.sh` 会交叉核对。`DEVECO_HOME` 覆盖两者。三套 Node 用例不再硬编码 Windows 路径，因此裸 `node scripts/test-<suite>.cjs` 在有默认安装的机器上可直接运行。

**改了其中一个解析器，必须同步另一个**，否则 `doctor.sh` 的 `resolver-agreement` 会变红。


## 2026-10-07 · 业务服务门禁补充

verify 新增 `logic-business`（Node 生产客户端规则/用例层）与 `backend-service`（Python/SQLite/临时回环 HTTP）阶段，完整流程9阶段、`--skip-build`为5阶段。doctor 检查 Python 3.10+ 与 SQLite。HTTP 测试需要允许回环端口监听；Hermes 仍为注入适配器，不代表真实后端联调。服务端启动仅支持 macOS/Linux。最新 ArkTS 基线为零，使用 `--deny-arkts-warnings`。


### 2026-10-09 · 验证证据仅本地保留

用户要求 `docs/testing/validation/` 不再上传GitHub；该目录及旧路径 `docs/validation/` 由 `.gitignore` 排除。Harness仍照常生成本地证据，不删除本地结果。不要用 `git add -f` 绕过规则。提交时仅保留05/10中的验证摘要；证据链接为本地导航，不保证GitHub或新克隆中可访问。
