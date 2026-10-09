# 13 · 鸿蒙开发 Harness 能力清单

更新：2026-10-07。本文档描述 HermesEye 的鸿蒙开发 harness **当前具备哪些能力、能力边界在哪、哪些声称的能力其实跑不通**。

定位：这是 harness 自身的说明书，不是产品需求，也不是验收结论。构建通过、逻辑测试通过、设备测试通过三者互不替代；实际交付状态以 [05 验收记录](../05-release.md) 与 [10 问题记录](10-test_record.md) 为准。

## 1. 总览

harness 由四部分组成：**三条命令**（环境 → 构建 → 设备）、**一套证据协议**、**三层测试资产**、**两个 Agent 技能**。

```bash
bash scripts/doctor.sh     # 环境能不能干活？只读
bash scripts/verify.sh     # 代码能不能编译、逻辑与本地单测过不过？不碰设备
bash scripts/device.sh     # 装到模拟器/真机跑设备用例、看日志、拉崩溃
```

三者严格单向：`doctor` 排除环境问题 → `verify` 拿到编译与逻辑证据 → `device` 才做设备验收。不要跳步，也不要用后一步的绿灯掩盖前一步的红灯。

| # | 能力 | 入口 | 状态 |
|---|---|---|---|
| 1 | 环境自检（25 项） | `bash scripts/doctor.sh` | 可用，已实测 |
| 2 | 构建/验证流水线（13 阶段） | `bash scripts/verify.sh` | 可用，已实测 |
| 3 | 设备闭环（7 子命令） | `bash scripts/device.sh` | 可用，模拟器已实测；真机未验证 |
| 4 | 跨运行时工具链解析 | `scripts/lib/deveco-env.{sh,cjs}` | 可用，已实测 |
| 5 | 测试资产（新增业务客户端/服务端） | 见 §5 | 可用，已实测 |
| 6 | Agent 技能（2 个） | `.dsh/skills/` | 可用，已被会话目录发现 |
| 7 | 文档结构/日志/性能分析 | `scripts/harness/analysis.cjs` | **代码可用但没有 CLI，当前不可达** |
| 8 | 性能采集 | — | **不具备** |
| 9 | 端到端真实联调 | — | **不具备（人工）** |
| 10 | 文档语义审查 | — | **不具备（人工）** |

## 2. `doctor.sh` — 环境自检

只读，不编译、不安装、不修改任何东西。回答一个问题：这台机器现在能不能构建和测试。

```bash
bash scripts/doctor.sh                  # 人读报告
bash scripts/doctor.sh --json out.json  # 机器可读报告
bash scripts/doctor.sh --strict         # 警告也返回 1（适合放门禁）
```

退出码：`0` 健康 / `1` 有失败（或 `--strict` 下有警告）。

**25 项检查**：

| 分类 | 检查项 |
|---|---|
| 主机 | `host`、`platform`（macOS/Linux/Windows 分级判定） |
| DevEco 工具链 | `deveco-home`、`resolver-agreement`（shell 与 Node 两套解析器是否指向同一安装）、`bundled-typescript`、`bundled-node`、`bundled-java`、`hvigor`、`ohpm`、`hdc`、`emulator`、`bundled-node-version`、`bundled-java-version` |
| SDK 与工程目标 | `sdk-installed`、`project-target`、`sdk-target-fit`（安装的 API 是否 ≥ 工程 `compatibleSdkVersion`） |
| 依赖 | `oh-modules`、`test-suite:domain`、`test-suite:services`、`test-suite:workspace` |
| 签名与设备 | `signing-config`、`signing-gitignore`、`device-connected` |
| Harness 资产 | `skills-present`（技能个数与名字）、`code-linter` |

2026-10-06 实测：19 PASS、4 INFO、2 WARN，exit 0。两个 WARN 都是**预期状态**——`signing-config`（`signingConfigs` 为空，产出未签名 HAP）、`code-linter`（DevEco 的 codelinter CLI 存在但不可用，见 §8）。

**边界**：它只说明环境就绪，不证明构建成功或设备验收通过。

## 3. `verify.sh` — 构建/验证流水线

唯一的验证入口。不签名、不安装、不启动任何设备侧内容；此处产出的 HAP 是**未签名**的编译证据。

```bash
bash scripts/verify.sh                          # 全流水线，约 12 秒
bash scripts/verify.sh --skip-build             # 跑规范门禁、四套 Node 与 Python 服务测试
bash scripts/verify.sh --label my-change        # 证据目录命名
bash scripts/verify.sh --deny-arkts-warnings    # 任何 ArkTS 告警即失败
bash scripts/verify.sh --keep-going             # 失败不中断，看全部阶段
bash scripts/verify.sh --timeout 1800           # 单阶段超时（默认 900 秒）
```

其余参数：`--date <YYYY-MM-DD>`、`--out <dir>`、`--no-unit-test`。
退出码：`0` 全部执行到的阶段通过 / `1` 有阶段失败 / `2` 环境不可用。

**13 个阶段**（默认快速失败）：

| 阶段 | 内容 |
|---|---|
| `standards` | `node scripts/check-standards.cjs`：docs/15 编码规范 + docs/16 日志规范的机检门禁，同时写出 `standards.json` |
| `standards-self-test` | `node scripts/test-standards.cjs`：门禁自身的用例（每条规则一个 fixture + CLI 分支） |
| `coverage` | `node scripts/coverage.cjs`：V8 块/行覆盖，按下限拦截并写出 `coverage.json` |
| `logic-domain` | `scripts/test-domain.cjs` |
| `logic-services` | `scripts/test-services.cjs` |
| `logic-workspace` | `scripts/test-workspace.cjs` |
| `logic-business` | `scripts/test-business.cjs` |
| `logic-ui-flows` | `scripts/test-ui-flows.cjs`（模拟点击业务流程；文件存在才执行） |
| `backend-service` | `python3 -m unittest discover -s backend/tests -v` |
| `hap-default` | 编译 `entry@default` debug HAP |
| `hap-ohostest` | 编译 `entry@ohosTest` HAP |
| `hypium-local` | 跑本地 Hypium 单元测试 |
| `hypium-result` | 校验结果行：`Run == Pass` 且 `Failure`/`Error` 均为 0 |

内建机制：每阶段独立日志、超时看门狗（macOS 无 `timeout`，脚本自带）、ArkTS 告警计数、`summary.json` 机器可读摘要。

`standards` 阶段是 2026-10-07 新增的第一个门禁：它不编译、不跑设备，只做静态规则判定（分层依赖、命名、类型、安全、日志 domain/tag/占位符/隐私、测试注册、Python 日志）。规则清单用 `node scripts/check-standards.cjs --list-rules` 查看，机读报告落在证据目录的 `standards.json`。`error` 级违规使整个流水线失败；`warn` 级只记录，存量清单见 [15 §10](../15-coding-standard.md)。

同批新增 `standards-self-test`（门禁自身 37 条用例）与 `coverage`（`scripts/coverage.cjs`）。覆盖率用 `NODE_V8_COVERAGE` 精确块覆盖 + source map 行号映射，按下限拦截：`core/*.ts` 100% 行/块、`services/*.ets` ≥95% 行/≥90% 块、门禁脚本 ≥90%。**注意合并口径**：V8 会省略与外层同计数的嵌套区间，因此必须按"每个进程各自的未执行集合"判定，不能跨进程取区间计数最大值，否则会把只在部分进程走到的分支误判为未覆盖。

2026-10-06 实测：**7/7 通过**，`hap-default` 与 `hap-ohostest` 均 **0 条 ArkTS 告警**，本地 Hypium 9/9。

### 绿灯证明了什么，没证明什么

| 通过 | 只说明 |
|---|---|
| 三套逻辑用例 | `core/` 的纯规则在 Node 里行为正确；平台能力全部是注入的 mock |
| `hap-*` | ArkTS 编译通过；未签名、未安装、未运行 |
| `hypium-local` | 本地 ArkTS 运行时下的领域行为正确 |

**都不代表**：权限授予、提醒注册、Asset Store 真实读写、日历访问、键盘避让、真实 Hermes 网络联调。

## 4. `device.sh` — 设备闭环

唯一接触设备的脚本。模拟器与真机**共用同一套子命令与参数**，差异只在签名。

```bash
bash scripts/device.sh status                  # 目标、机型、API、是否已安装、产物、签名状态
bash scripts/device.sh install                 # 装主包 + ohosTest 包
bash scripts/device.sh launch                  # 启动 EntryAbility 并确认进程存活
bash scripts/device.sh test                    # 跑 ohosTest，全过才返回 0
bash scripts/device.sh log --app --seconds 20  # 抓本应用进程的 hilog
bash scripts/device.sh faults                  # 拉崩溃/冻屏日志并打印 Reason 与栈顶
bash scripts/device.sh uninstall
```

| 子命令 | 通过条件 |
|---|---|
| `status` | 打印目标、机型、API、软件版本、是否已安装、两个 HAP 产物是否就绪、签名状态 |
| `install` | 主包与测试包均返回 `install bundle successfully` |
| `launch` | `aa start` 成功后进程仍存活 |
| `test` | transcript 中 `Run == Pass` 且 `Failure`/`Error` 均为 0，否则返回 1 |
| `log` | 指定时长内 `hilog` 有输出，写入证据目录 |
| `faults` | 列出并拉取本 bundle 的崩溃日志，打印 `Reason`、`Error message`、栈顶 3 帧 |
| `uninstall` | 两个包均卸载成功 |

**11 个参数**：`--target <serial>`、`--timeout <sec>`、`--seconds <n>`、`--app`、`--level`、`--type`、`--domain`、`--tag`、`--all`、`--out <dir>`、`--allow-any-target`。

内建保护（避免含义不明的失败）：

- **真机保护**：目标不是 `emulator` 且 `build-profile.json5` 无签名配置时，`install`/`test` 直接失败并打印配置指引；`--allow-any-target` 可强行尝试。
- **`--app` 保护**：应用未运行时失败并提示先执行 `launch`，不静默返回空结果。
- **多目标**：自动选第一个并提示用 `--target` 覆盖。

2026-10-06 实测：模拟器 `emulator` / API 26 / 软件版本 7.0.0.107；未签名 HAP 安装成功；`test` **5/5 通过**（含真实 Asset Store 用例）。

### 签名边界

DevEco 内置模拟器镜像放宽了签名校验，**接受 `verify.sh` 产出的未签名 HAP**；**真机不会**，必须签名。接入真机不需要改脚本，只需在 DevEco 生成签名配置（File → Project Structure → Signing Configs，需华为开发者账号）并把 `signingConfigs` 块写进 `build-profile.json5`，然后重新 `verify.sh`。`doctor.sh` 会由 WARN 转为 PASS。签名材料受 `.gitignore` 保护。

## 5. 测试资产（267 个自动用例）

| 层 | 位置 | 数量 | 依赖 | 命令 |
|---|---|---|---|---|
| 规范门禁自测 | `scripts/test-standards.cjs` | **37** | 仅 DevEco 自带 Node | `verify.sh` |
| 生产逻辑 | `scripts/test-*.cjs` | **183**（domain 23 / services 45 / workspace 79 / business 30 / ui-flows 6） | 仅 DevEco 自带 Node + TypeScript | `verify.sh --skip-build` |
| 服务端 | `backend/tests/test_service.py` | **12** | Python 3.10+ / SQLite / 回环端口 | `verify.sh` |
| 本地 Hypium | `entry/src/test/LocalUnit.test.ets` | **10** | 本地 ArkTS 运行时 | `verify.sh` |
| 设备 Hypium | `entry/src/ohosTest/ets/test/Ability.test.ets`、`Flow.test.ets` | **8** | 模拟器/真机，含真实 Asset Store 与模拟点击 | `device.sh test` |

Node 用例把生产源码在内存中转译后在 Node VM 里执行并断言，**无需设备、无需网络**。这也是为什么平台 API 必须留在 `services/`——写进 `core/` 会直接让这些用例失败。`test-ui-flows.cjs` 用文本切片抽取 `Index.ets` 的交互方法，把点击建模为轨迹后断言状态与持久化结果。

**选层原则**：新增用例优先放 Node 套件（秒级、无设备、失败信息直接）；确实依赖 ArkTS 运行时或系统能力时才升级到 Hypium；交互与导航改动必须补设备 UiTest。

## 6. 证据协议

| 命令 | 落盘位置 | 内容 |
|---|---|---|
| `verify.sh` | `docs/testing/validation/<日期>-<标签>/` | `results.txt`（全程摘要）、`summary.json`（阶段状态/耗时/告警数/环境）、各阶段 `<阶段>.log`、`hypium-result.txt` |
| `device.sh test` | `docs/testing/validation/<日期>-device/` | `device-test.txt`（完整 transcript）、`device-test-summary.txt` |
| `device.sh log` | 同上 | `hilog.txt` |
| `device.sh faults` | 同上 `faultlog/` | 崩溃日志原件 + `index.txt` |

写交付结论时引用这些文件，不要只贴聊天输出。`summary.json` 的字段：`label`、`date`、`generatedAt`、`devecoHome`、`sdkApiLevel`、`projectCompatibleSdk`、`skipBuild`、`passed`、`total`、`ok`、`stages[]`。

## 7. Agent 技能

`.dsh/skills/` 下的技能由 DSH 以**项目根最高优先级自动发现**（`<projectRoot>/.dsh/skills`，rank 100），改动即时生效、无需重启。

| 技能 | 何时生效 |
|---|---|
| `harmonyos-arkts` | 编写/修改 ArkTS、ArkUI 代码：语言约束、`@throws` 处理规则、ArkUI V1 状态管理、资源与主题、安全红线 |
| `harmonyos-harness` | 构建、验证、设备验收：三条命令用法与边界、日志查看路径、三层测试取舍、ArkTS 告警基线、已知限制、真机预留 |

技能为目录束格式 `<name>/SKILL.md`，YAML frontmatter 必填 `name` 与 `description`；嵌套的 `**/SKILL.md` 不会被发现。

## 8. 日志查看路径

| 要查什么 | 去哪 |
|---|---|
| 应用运行行为、状态流转 | `bash scripts/device.sh log --app --seconds 20` |
| 交互式排查、配合断点 | DevEco Studio → Log 窗口 → HiLog 标签 |
| 闪退、白屏、无响应 | `bash scripts/device.sh faults` |
| 抓取之前的历史日志 | 设备 `/data/log/hilog/*.gz`，`hdc file recv` 拉取 |
| 编译失败、ArkTS 告警、Hypium 失败 | `docs/testing/validation/<日期>-<标签>/` 下的 `results.txt` 与各阶段 `.log` |
| DevEco IDE 自身问题 | `~/Library/Logs/Huawei/DevEcoStudio26.0` |

**抓应用日志必须带 `--app`。** 未过滤的 hilog 几乎全是系统与应用框架噪音——实测 8 秒内应用自身有效日志只有 9 行，其余几百行来自 sceneboard、wifi_manager、netmanager 等系统进程。`--app` 用 `pidof <bundle>` 解析进程号后按 `-P` 过滤。

三个相关坑：

- `hilog -t app` 只区分 app/core/init 类型，**挡不住系统应用**（sceneboard 也是 app）。
- 本工程 domain 与 tag 是 DevEco 模板默认值（`0x0000` + `'testTag'`），**过于通用，`-D`/`-T` 无法隔离本应用**。新增模块日志应分配独立 domain/tag，例如 `hilog.info(0x1200, 'Workspace', ...)`。
- `hdc shell hilog -x` 里的 `-x` 会被 hdc 自己吞掉；远端命令必须作为**单个字符串**传入：`hdc shell "hilog -T MyTag"`。`-x` 还会先打印整个环形缓冲区，实时抓取要用阻塞读取。

崩溃日志格式：`/data/log/faultlog/faultlogger/<kind>-<bundle>-<uid>-<timestamp>.log`，`kind` 为 `jscrash` / `cppcrash` / `appfreeze`。

## 9. 工具链解析

`scripts/lib/deveco-env.sh`（shell）与 `scripts/lib/deveco-env.cjs`（Node）是定位 DevEco Studio 的唯一来源，**两边候选列表必须一致**：

| 平台 | 候选 |
|---|---|
| macOS | `/Applications/DevEco-Studio.app/Contents`、`~/Applications/DevEco-Studio.app/Contents` |
| Windows | `D:/dev-tools/DevEco Studio`、`C:/Program Files/Huawei/DevEco Studio` |
| Linux | `~/DevEco-Studio`、`/opt/deveco-studio` |

`DEVECO_HOME` 覆盖两者。`doctor.sh` 的 `resolver-agreement` 检查会交叉核对两套解析结果是否指向同一安装——**改了其中一个解析器必须同步另一个**，否则该检查会变红。

三套 Node 用例已不再硬编码 Windows 路径，因此裸 `node scripts/test-domain.cjs` 在任何有默认安装的机器上都能直接运行；给一个无效的 `DEVECO_HOME` 会自动回退到候选列表。

## 10. 已实现但当前不可达

| 文件 | 状态 |
|---|---|
| `scripts/harness/analysis.cjs` | 148 行，导出 `auditDocs` / `analyzeLogs` / `evaluatePerformance`。**三个函数实测均正常**，输出带诚实的 `limitations` 字段 |
| `scripts/harness/capabilities.json` | 声明 11 条能力，其中 **5 条**命令指向 `node scripts/harness.cjs …` |

**`scripts/harness.cjs` 在仓库中不存在**。那 5 条命令实跑全部 `MODULE_NOT_FOUND`：

```
node scripts/harness.cjs docs           # 文档结构审计
node scripts/harness.cjs verify logic   # 逻辑用例
node scripts/harness.cjs logs <file>    # 日志分析
node scripts/harness.cjs perf <samples> # 性能样本评估
```

因此 `analysis.cjs` 的三个分析函数目前**无法被调用**——缺的不是能力，是 CLI 接线。`capabilities.json` 因此在被修正前**不能作为能力清单引用**。

**待办**：二选一——补 `scripts/harness.cjs` 把三个函数接出来（推荐，代码不白写），或删掉 `capabilities.json` 中无法执行的条目。

## 11. 明确不具备的能力

| 能力 | 状态 | 说明 |
|---|---|---|
| 性能采集 | **缺失** | 无 profiler/trace 适配器，无实测基线。`evaluatePerformance` 只对**已采集样本**做 p50/p95/max 与预算比较，预算需项目自定义，非鸿蒙官方标准 |
| 端到端验收 | **人工** | 无统一自动化执行器；真实 Hermes、授权账号、权限、提醒、后台链路按 [04 测试计划](04-test-plan.md) 的验收矩阵人工执行 |
| 文档语义审查 | **人工** | 无自动语义判定器；`auditDocs` 只查文档存在性、Markdown 内联链接、AGENTS 导航覆盖与标题层级，不查锚点、HTML 链接、引用式链接或语义一致性 |
| 代码静态检查（lint） | **不具备** | DevEco codelinter CLI（`plugins/codelinter/run/index.js`，`-v` 报 6.0.240）支持 `-c/-o/-f/-e` 参数，但实际 lint 一律失败：`{"messageType":0,"content":"Some error occurred during linting..."}` 且 `EXIT=255`，无 stderr；换作用域、去掉配置、加语言参数均无改善。它是版本锁定的 IDE 插件，因此**流水线不包含 lint 阶段**；`code-linter.json5` 的规则目前只能在 DevEco Studio 内执行。可用的替代信号是 ArkTS 编译器诊断（已纳入 `verify.sh`） |
| 真机验收 | **未验证** | 无签名材料、当前无真机。脚本接口已预留，但该路径从未跑通 |
| CI | **不具备** | 所有验证均在本机手动触发，证据靠 `docs/testing/validation/` 人工沉淀 |

## 12. 已知限制与踩过的坑

改 harness 脚本时别再犯：

- **macOS 没有 `timeout`**。需要超时就自己实现看门狗（`verify.sh` 的 `run_stage` 即是），不要依赖 `timeout` 命令。
- **看门狗子 shell 必须把 stdout/stderr 重定向到 `/dev/null`**，否则它的 `sleep` 会继承调用者的管道，让调用方（如 `| tail`）一直挂到超时结束。
- **必须在 `wait` 之后才拆看门狗**。顺序反了会把 `sleep` 提前杀掉，导致 `wait` 永久阻塞。
- **`hdc shell <cmd>` 的参数会被 hdc 自己解析**，带 `-` 选项的命令要作为单个字符串传入。
- **bash 3.2（macOS 自带）在 `set -u` 下展开空数组会报未绑定变量**，用 `${arr[@]+"${arr[@]}"}` 保护。

## 13. 维护约束

- 改 `scripts/lib/deveco-env.*` 其中之一，必须同步另一个。
- 新增、移动或删除 `docs/` 文件时同步维护 [AGENTS.md](../../AGENTS.md) 的文档导航。测试相关文档与证据统一放在 `docs/testing/`（文档 04/10/13；证据 `docs/testing/validation/`）。
- 本文档记录**能力**；实测结论与未测范围写 [05](../05-release.md)，问题现象与根因写 [10](10-test_record.md)，测试层次与验收矩阵写 [04](04-test-plan.md)。
- ArkTS 告警基线当前为 **0**（问题8 已于 2026-10-06 清理完毕，见 [10](10-test_record.md)）。改动不应让这个数字回升，可用 `verify.sh --deny-arkts-warnings` 作为门禁。
- 不将"已定位""已实现"记为"已验收"。能力存在不等于场景通过。


## 2026-10-07 · 业务服务扩展验证

新增 Python 3.10+/SQLite 环境检查及 `test-suite:business`。当前实际通过 109 项 Node（15+33+48+13）、12 项服务端与回环 HTTP 测试、10 项 Previewer，完整 9/9 阶段且 ArkTS 零告警。前文 2026-10-06 的数量作为历史批次保留。新增1项业务入口设备用例已编译，但执行结果以05为准。

服务端测试需要允许临时回环监听；服务进程默认只绑定127.0.0.1，不能据此认为手机已能连接。`doctor`/`device status`在受限沙箱内可能误报无设备，需核对实际 hdc 权限。真实 Hermes 仍不在自动化覆盖范围。

## 2026-10-07（第二轮）· 规范门禁、覆盖率门禁与模拟点击

当前实际通过：**13/13 阶段**（`--skip-build` 9 阶段）且三处编译均 ArkTS 零告警。用例总量 **267**：门禁自测 37、Node 生产逻辑 183（domain 23 / services 45 / workspace 79 / business 30 / ui-flows 6）、服务端 12、Previewer 10、设备 8（模拟器 API 26 实测 8/8）。覆盖率为 `core` 100%/100%、`services` 99.6% 行 / 99.3% 块、门禁脚本 96.6%/92.9%，0 项不达标。

新增资产：`scripts/check-standards.cjs`（31 条规范规则）、`scripts/test-standards.cjs`、`scripts/coverage.cjs`、`scripts/test-ui-flows.cjs`（F01–F06 点击轨迹）、`entry/src/ohosTest/ets/test/Flow.test.ets`（U08/U09 设备点击）。前文 2026-10-07 首轮的数量（109 项 Node / 9 阶段）作为历史批次保留。

覆盖率口径的坑：V8 会省略"与外层同计数"的嵌套区间，跨进程取区间计数最大值会把只在部分进程走到的分支误判为未覆盖；必须按"每个执行过该函数的进程各自的未执行集合"判定（见 `coverage.cjs` 注释与 [15 §8.1](../15-coding-standard.md)）。


### 2026-10-09 · 验证证据仅本地保留

用户要求 `docs/testing/validation/` 不再上传GitHub；该目录及旧路径 `docs/validation/` 由 `.gitignore` 排除。Harness仍照常生成本地证据，不删除本地结果。不要用 `git add -f` 绕过规则。提交时仅保留05/10中的验证摘要；证据链接为本地导航，不保证GitHub或新克隆中可访问。
