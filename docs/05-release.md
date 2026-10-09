# HermesEye · V1.0 重构与验收记录

日期：2026-10-01。状态：客户端重构与本机自动测试已完成本轮验证，**完整 V1.0 尚未完成，不是正式发行版**。需求以 [08](08-product-requirements-V1.0.md) 为准。

## 本轮工程变更
- 今日 / 项目 / 阅读 / 我的四入口；今日计划 → 项目进展 → 最近在读。
- 动态项目、托管方式、目标与下一步、每日事务及明确状态、本机收件箱。
- 所有发送基于需求，独立“漫无目的”会话可找回、重命名、移动；原事项链接与消息历史保留。
- 区间记录、补记、精力自述、决策/待办；本机汇总引用来源，不冒充已确认的自动日报。
- 阅读完整指标与缺失态、书籍归属、运行事件/成果/部署回执模型和展示；没有生成示例远端数据。
- 连接表单及分阶段状态、系统安全凭据存储、服务器隔离、主题持久化、原子保存及旧数据迁移。
- 重新设计领域、迁移、隔离、安全保存失败回滚和 Hypium 用例；添加可复现 DevEco 验证脚本。

## 实际执行结果
环境：macOS、已安装 DevEco Studio、HarmonyOS 6.1.1 / API 24、自带 Node / Java / Hvigor / Previewer。

|检查|实际结果|证明范围|
|---|---|---|
|`test-domain.cjs`|11 组通过|输入、地址、分享、快照、文本协议与旧格式|
|`test-services.cjs`|8 组通过|注入网络/文件适配器，停止、迟到回复与旧存储保护|
|`test-workspace.cjs`|23 组通过|需求关系、迁移、服务器隔离、记录、原子存储与凭据协调|
|DevEco Hvigor `test`|4 项通过，0 失败，0 错误|Previewer 执行真实 ArkTS 领域用例；不是设备UI|
|主应用 Debug HAP|编译打包通过|ArkTS 与资源；未签名|
|`entry@ohosTest` HAP|编译打包通过|新设备UI与Asset Store用例可编译；未执行|
|`hdc list targets`|`[Empty]`|无已连接设备或运行中的模拟器|
|签名安装 / 设备 UI / Asset Store 重启|未运行|需要目标设备/模拟器及签名|
|真实 Hermes / Tailscale / 服务端重启 / 多端|未运行|未提供可达实例与实际协议|
|微信读书 / IMA / 健康 / Vault / 多 Agent / 部署|未接入、未验证|不能计为V1.0通过|

可复核证据：[自动验证摘录](testing/validation/V1.0/automated-results.txt)、[Hypium 原始结果](testing/validation/V1.0/hypium-result.txt)。完整本机 HTML 报告由 DevEco 生成在 `entry/.test/default/outputs/test/reports/index.html`，不提交生成目录。

编译仍有系统 API “可能抛出异常”的静态提示，调用入口捕获错误；设备异常行为仍需实测。设备测试包存在工具生成资源的 `start_window_background` 重复声明警告，未阻止构建。

## 重现步骤
```sh
# 默认 /Applications/DevEco-Studio.app/Contents，必要时覆盖 DEVECO_HOME
bash scripts/test-deveco.sh
```
脚本顺序运行三套 Node 回归、Debug 主包、ohosTest 测试包、Previewer Hypium，并核对结果文件中的失败数；出现错误即停止。脚本不签名、不安装、不上传用户数据，也不调用真实 Agent。

设备自动用例在 `entry/src/ohosTest/ets/test/Ability.test.ets`。在 DevEco 中配置签名、连接已解锁测试设备，运行主应用至今日首页，然后执行该套件。设备用例覆盖导航、阅读缺失表达和真实安全资产跨实例读取；跨进程/重启、权限撤销、锁屏和后台提醒仍按测试矩阵补齐。

## 发布范围与阻塞
这轮改写没有核验或实现真实 Hermes 的业务同步/服务端会话、远端运行控制、部署、双Vault、读书/健康链路及周期强提醒。它们仍是 V1.0 发布前的必需工作，不是从需求中移除。

待提供：家庭 Hermes 版本/接口和可达地址；目标设备/签名；周期时段、量表、模板及自动化授权策略。凭据只在应用本机填写。详见 [交付计划](06-project-plan.md) 与 [验收矩阵](testing/04-test-plan.md)。

历史 v0.1.0 包与其验收保留在 `releases/v0.1.0/` 和 [历史报告](history/V0.2/05-release.md)，未覆盖、未作为 V1.0 产物。当前 unsigned HAP 不表示可直接正式安装发行。

## 导航栏草图对齐 · 2026-10-01
已按设计任务中确认的 `.he-nav` 调整图标、字号、密度、选中态与分隔线，并移除标签前圆点。设备UI测试改用稳定导航控件ID定位。主应用与设备测试包 DevEco 编译通过；三套逻辑回归共42组通过。本轮未运行设备UI或取得真机视觉截图。

## 状态样式启动崩溃修复 · 2026-10-01
模拟器 09:44 的 JS Crash 指向 `WorkspaceNavigation.ets` 的 `stateStyles`：对象属性写法被编译为不存在的 `Button.$r(...)` 调用。导航按钮、通用操作按钮及输入框共三处均改为 `.backgroundColor(...)` / `.border(...)` 样式调用。

验证：DevEco Debug HAP 构建通过；检查生成代码，已正确输出资源对象和组件样式方法，没有 `.$r(...)` 调用。通过 hdc 保留数据覆盖安装并启动成功；09:58:25 检查应用进程仍在运行（PID 14321），崩溃目录未新增 HermesEye 报告，最近一次仍为修复前 09:44 的日志。本次完成启动冒烟验证，未覆盖全部页面交互、按压及焦点视觉验收。

## 键盘遮挡修复 · 2026-10-02

范围：仅处理 `10-test_record.md` 第一项键盘遮挡，第二项会话结果刷新未修改。

页面使用 `RESIZE_WITH_CARET` 缩小可用高度并跟随输入光标；基于实际键盘高度隐藏／恢复手机底部导航。主体保持剩余空间内滚动，状态提示和等待操作纳入滚动区，多行输入高度限定为 96～160vp，长文本在输入框内滚动。键盘开合不清空草稿、不主动重置页面滚动位置。平台适配放在 `KeyboardAvoidance.ets`，销毁时注销监听，忽略异步查窗及旧事件的迟到回调。

| 验证 | 结果与范围 |
|---|---|
| 三套 Node 逻辑回归 | 46 组通过（领域 11、服务 12、工作区 23）；新增 4 组键盘模式、初始状态和监听生命周期用例 |
| Debug 主包、设备测试包 | DevEco API 24 编译打包通过；仍有系统 API 异常处理静态提示 |
| Previewer Hypium | 4 项通过、0 失败、0 错误；沙箱内首次运行无响应，结束该测试进程后在沙箱外重跑通过 |
| 模拟器覆盖安装 | `127.0.0.1:5555` 保留应用数据安装成功 |
| 模拟器 Hypium | 4 项通过、0 失败、0 错误；修正测试前台启动与页面切换等待，按设备实际行为处理找不到控件时返回 null |
| 键盘 UI 回归 | 新建项目页：弹出后底部导航隐藏、滚动区底边上移；输入单行／多行文字；键盘保持打开时可滚动到创建按钮；收起后导航与可用高度恢复、草稿保留；未创建项目或发送 Hermes 请求 |
| 待用户／设备复测 | 连接表单、会话、记录等其他页面的逐项输入体验；长中文与超长文本、横屏、分屏、大字号、不同输入法、真机 |

证据：[设备 Hypium 结果](testing/validation/keyboard-2026-10-02/device-tests.txt)、[Previewer 结果](testing/validation/keyboard-2026-10-02/previewer-tests.txt)。应用冷启动可能按已有配置执行自动连接检测；键盘测试本身不提交业务数据。

视觉复核：模拟器竖屏中文输入法下，输入框处于键盘上方，底部导航隐藏；在输入框外侧滑动可将完整“创建项目”按钮滚动到键盘上方。截图：[键盘弹出](testing/validation/keyboard-2026-10-02/keyboard-open.png)、[滚动到提交按钮](testing/validation/keyboard-2026-10-02/keyboard-scroll.png)。

## 手机日历读取权限修复 · 2026-10-02
模拟器日志显示旧版查询进入 `DataShareHelper in low permission`，查询成功但返回零条日程。原实现仅声明和请求 `READ_CALENDAR`，现统一使用 `READ_WHOLE_CALENDAR`，用于读取手机日历中其他应用创建的今日日程；仍仅在用户点击后申请，只读，不自动上传。拒绝授权时提示到系统设置恢复授权。

验证：三套 Node 回归 49 项通过（含新增 3 项日历测试），DevEco Debug HAP 构建通过，保留数据覆盖安装到模拟器并启动成功。尚待用户在系统权限弹窗中授权后，验证已有今日日程可见；未代替用户授予隐私权限。

## 测试用例重新设计 · 2026-10-03

范围：按当前 V1.0 代码重新设计全部测试用例（[04](testing/04-test-plan.md) 重写为 N/S/W/L/U 五个编号系列），并针对 [10](testing/10-test_record.md) 两项模拟器实测问题补充回归设计。本轮只改测试与文档，未改生产代码。

新增用例：领域 4 项（上下文 10 条上限、裸提示词、回复 32000 字边界、cleanText 上限边界）；服务 7 项（连接检测端点与失败分类、空白 Token/空引用、提醒通知顺序与工作日集合、非法提醒输入、取消透传）；工作区 11 项（深拷贝隔离、发送新快照契约、缺失空间、连接/空间不匹配、悬空链接、空白重命名、纯正文记录按保存日汇总、畸形历史地址、默认端口、重复保存替换凭据、空白 Token 不留痕）；Previewer Hypium 3 项（拷贝隔离、发送快照契约、悬空链接）。

模拟器问题 2（会话页发送后不刷新）完成根因分析：数据层 `send()` 正确，UI 层 `chat(need)` 按值传参导致 builder 渲染发送前旧对象；W18/L06 锁定数据层契约，D13-② 定义修复后的手动验收步骤，U05 待有桩服务后自动化。本轮未修改该缺陷。

| 验证 | 实际结果 |
|---|---|
| `test-domain.cjs` / `test-services.cjs` / `test-workspace.cjs` | 15 / 22 / 34 项通过，共 71 项 |
| DevEco Hvigor `test`（Previewer） | 7 项通过，0 失败，0 错误 |
| 主应用与 ohosTest Debug HAP | `test-deveco.sh` 退出码 0，编译打包通过 |
| 设备 UI / 真实 Hermes | 本轮未运行（无已连接设备） |

证据：[本轮验证摘录](testing/validation/test-redesign-2026-10-03/results.txt)。

## 日历内容响应式刷新修复 · 2026-10-03
00:48 的模拟器日志确认 `READ_WHOLE_CALENDAR` 生效（high permission），GetEvents 成功返回至少一条日程。展示仍未更新的原因是日历字符串按值传入 `@Builder hint`，生成代码闭包保留初始文本。每日计划和数据来源页改为 Text 直接读取 `@State snapshot`，采集时间一并处理。

三套逻辑回归及 DevEco Debug HAP 构建通过；生成代码确认状态读取位于 Text 的更新回调内。已保留数据覆盖安装并启动模拟器应用。尚未完成修复后点击刷新、连续刷新和跨页返回的视觉验收。

## 问题2：会话历史原地刷新 · 2026-10-03
消息列表改为在 ForEach 更新回调内调用 `selectedNeed()`，直接追踪最新工作区状态；不再从按值传入的旧 Need 对象读取消息。没有修改发送时序、加载动画或提示方式。

验证：三套 Node 逻辑回归通过（包含新旧工作区消息快照隔离用例）；DevEco Debug HAP 构建通过；生成代码确认 `forEachUpdateFunction` 在更新回调内读取 `this.selectedNeed()?.messages`。未执行真实 Hermes 两轮收发的设备 UI 验收，也未重新安装模拟器；仍按问题记录 D13-② 复测。问题3–6仅在 `10-test_record.md` 增加分析、交互方案、数据边界及验收设计，未实施。

## 问题3–5：发送反馈与日历导入 · 2026-10-03
会话请求等待期间展示临时用户气泡及就地加载/停止操作，失败保留输入，成功后正式历史替换临时内容。操作通知统一为 Toast，移除顶部提示与全局加载区。日历读取改为实例列表，支持选择后确认加入今日计划，保存可选来源信息并按日历、事件与实例时间去重，保持旧数据兼容。

验证：三套 Node 回归通过，其中工作区 39 项（含生产 send 等待、双击、网络失败、磁盘失败及日历导入测试）；DevEco 主包与 ohosTest 包构建通过。已保留数据覆盖安装并启动模拟器。尚未执行本轮设备 UI 自动测试或真实 Hermes 联调；Toast/滚动位置及系统日历导入视觉验收仍待复测。问题6未实施。详细边界见 `10-test_record.md` 实施记录。

## 问题1–5回归测试重构 · 2026-10-03

范围：按 [10](testing/10-test_record.md) 问题1～5 的修复重设计回归（[04](testing/04-test-plan.md) 同步更新），保证后续重构可依赖自动回归。本轮只改测试与文档，未改生产代码。

新增用例：服务 2 项（日历今日范围剔除与多日历合并排序、实例时间回退与全天缺省）；工作区 8 项（send 失败就地保留气泡与错误、跨会话草稿隔离、空选择与按空间去重、calendarSource 校验与旧计划兼容、超长标题导入原子失败、Toast 去重与时长、会话页与 Toast 两条页面源守卫）；Previewer Hypium 2 项（日历导入与来源校验镜像）。

| 验证 | 实际结果 |
|---|---|
| `test-domain.cjs` / `test-services.cjs` / `test-workspace.cjs` | 15 / 25 / 47 项通过，共 87 项 |
| DevEco Hvigor `test`（Previewer） | 9 项通过，0 失败，0 错误 |
| 主应用、ohosTest、Previewer 构建 | `test-deveco.sh` 退出码 0，3 次 BUILD SUCCESSFUL |
| 设备 UI / 真实 Hermes | 本轮未运行；D13-①～⑤ 手动与设备验收待执行 |

证据：[本轮验证摘录](testing/validation/issues-1-5-tests-2026-10-03/results.txt)。

## 每日计划模块设计与实现 · 2026-10-03

新增按日导航、独立编辑/改期、重要性/用时/说明、直接设置状态与筛选、移除确认及会话保留、所选日期日历导入与重叠占用统计、前7天历史规则建议及逐项采纳。事务数量排除日历事项；旧计划继续兼容 version=2。

本轮未新增测试用例，仅为既有服务注入加载器补充运行时依赖。现有三套 Node 回归 15/25/47 共87项通过，Debug 主应用与 ohosTest 包构建通过，Previewer 9项通过。沙箱内 Previewer 无响应，终止后在沙箱外执行同一验证脚本通过。设备UI、权限、锁屏提醒、真实Hermes及新增行为完整验收本轮未执行；未签名、未安装或发布。

交付：[模块规格](modules/11-daily-plan-spec.md)、[开发过程](modules/12-daily-plan-implementation.md)、[交互稿](design/daily-plan/index.html)、[验证证据](testing/validation/daily-plan-2026-10-03/results.txt)。远端个性化建议、强提醒直达及业务同步仍未接入。

## 问题8 SDK 异常处理 · 2026-10-06

按用户要求处理 21 处 SDK `@throws` 告警。逐点捕获 SDK 同步异常及 Promise 拒绝，按已核对的 SDK 错误码区分可恢复边界，保留脱敏操作/错误码诊断，不记录原始 SDK 文案、凭据或业务正文。文件失败不替换旧数据，安全存储失败不降级明文；权限拒绝不读取日历或注册提醒。仅删除已不存在的凭据、取消已不存在的提醒及清理已销毁窗口按目标已满足处理，其余错误显式抛出或交由页面恢复流程处理，不自动重试。

附带健壮性修复：工作区读取失败后禁止写入；写入和关闭同时失败保留两份诊断；键盘初始化失败清理监听；孤立安全凭据清理失败记录诊断；Toast 展示失败不改变业务保存结果、不计入去重。Toast/主题 SDK 调用下沉至服务层，页面布局及正常交互不变。

| 检查 | 实际结果 |
|---|---|
| doctor | 工具链与依赖可用，SDK 26 ≥ 工程 API 24；未配置真机签名，IDE lint 仍需手工执行 |
| `verify.sh --deny-arkts-warnings --date 2026-10-06 --label issue8-final --timeout 120` | **7/7 阶段通过** |
| Node 领域／服务／工作区 | **15 / 33 / 48，共 96 组通过**；新增 8 组服务异常与 1 组 Toast 恢复回归 |
| 主应用／设备测试包 ArkTS 告警 | **21 → 0 / 1 → 0**；两包均实际重新编译，无关闭或过滤告警 |
| Previewer Hypium | **9/9 通过，0 失败、0 错误** |
| `device.sh install` | API 26 模拟器 `127.0.0.1:5555` 两包保留数据覆盖安装成功 |
| `device.sh test` | **5/5 通过，0 失败、0 错误**：导航、阅读缺失态、键盘、真实缺失凭据、真实 Asset Store 跨实例读写 |

设备测试使用独立随机别名验证缺失凭据，不删除用户已有凭据。未读取用户日历、未更改权限、未调用真实 Hermes 聊天；应用冷启动仍可能按用户已有配置自动检测连接。

未验证范围：API 24 真机、锁屏下凭据访问、日历/通知权限实际拒绝与撤销、真实存储空间耗尽和窗口销毁竞态。它们只有注入失败回归或验收步骤，不声称全部设备异常已经复现通过。页面无视觉布局变更，本轮不新增截图。

证据：[最终结果](testing/validation/2026-10-06-issue8-final/results.txt)、[摘要](testing/validation/2026-10-06-issue8-final/summary.json)、[设备测试](testing/validation/2026-10-06-issue8-device/device-test.txt)。首次编译遇到 ArkTS `throw` 类型限制，改为 `throw error as Error` 后重新通过完整门禁；[初次记录](testing/validation/2026-10-06-issue8/results.txt)保留为迭代证据，不作为最终结论。

## 2026-10-07 · A2 独立业务服务本地预览

按用户实施要求，新增 Python/SQLite 业务服务、鸿蒙业务副本/用例层/HTTP适配/原子持久化，以及“我的”中的独立业务预览入口。支持版本同步、墓碑、持久去重回执、双版本冲突选择、会话映射/轮换、执行账本和未知结果查询。旧 v2 业务不自动迁移；完整边界见架构第13节及 backend/README.md。

### 实际验证

- `doctor.sh`：Python/SQLite、DevEco、SDK与依赖可用；沙箱外可识别 `127.0.0.1:5555` 模拟器/API26。未配置真机签名，CodeLinter CLI仍不可用。
- `verify.sh --date 2026-10-07 --label architecture-v1-verified --deny-arkts-warnings`：**9/9阶段通过**；Node **109/109**（15+33+48+13），服务端 **12/12**，Previewer **10/10**；主包、测试包及本地测试 **0条 ArkTS 告警**。
- 新增业务设备入口用例已编译；本轮主包安装连续超时，独立 `hdc file send` 30秒也未完成。因此**本轮设备测试未执行**，不把已安装的旧包或前批5/5结果当成本轮证据。
- `git diff --check` 通过。服务测试使用临时 SQLite 和真实回环 HTTP；Hermes为注入实现，无家庭服务器访问或部署。

证据：[最终结果](testing/validation/2026-10-07-architecture-v1-verified/results.txt)、[摘要](testing/validation/2026-10-07-architecture-v1-verified/summary.json)、[环境](testing/validation/2026-10-07-architecture-v1-verified/doctor.json)、[安装超时](testing/validation/2026-10-07-architecture-v1-device/install-retry.txt)、[分步传输](testing/validation/2026-10-07-architecture-v1-device/manual-install.txt)。首次编译失败（ArkTS构造器参数属性/显式接口）已修正，保留[诊断](testing/validation/2026-10-07-architecture-v1/hypium-local.log)。

### 未完成与未验证

这是共享基础的本地预览，不是完整V1.0交付。原四页完整接入、显式旧数据迁移、跨业务实体关联事务、完整远端历史UI、审批/调度/知识/部署模块仍待实现。真实Hermes网络契约、Ubuntu部署、业务预览全流程设备操作、运行事件恢复和真机权限均未验收。设备传输恢复后须重新安装最新两包，再运行6项设备用例及人工业务流程。

## 2026-10-07 · 真实 Hermes 本机联调

用户明确要求真实联调，使用其提供的 `http://127.0.0.1:8642` 与上游凭据。凭据通过无回显进程输入进入内存，未写入仓库、证据或命令行参数。使用生产 `backend/server.py` HTTP handler、`Service`、`Store`、`Hermes` 适配器，独立临时业务端口与测试数据库；没有替换日常业务数据。

### 实际通过

- 错误凭据访问能力接口返回401；正确凭据成功读取 `/v1/capabilities`、`/v1/models`（1个模型）。能力响应字段为 `auth/endpoints/features/model/object/platform/runtime`；未将配置能力等同于全部接口已验证。
- 业务HTTP身份、合成计划提交及增量同步成功；计划只进入隔离业务测试库，不上传日历等私人来源。
- 业务HTTP → 持久操作意图 → 官方原生会话 → 回复保存成功。第一轮2.69秒，回复为测试标识；无工具操作请求。
- 同一operationId重复提交返回相同结果；对比前后该测试会话的远端消息响应，没有新增消息。查询原操作成功。
- 关闭并重新打开账本后保留回执/绑定；另起Python进程再次提交原operationId仍不增加远端消息。
- 新进程向同一Need发送第二轮，仅要求复述上一条回复，未重发历史；1.14秒完成，返回正确标识且sessionId未变化。远端隔离会话共4条消息，未见tool/function消息或tool_calls。

证据：[脱敏摘要](testing/validation/2026-10-07-hermes-live/results.txt)、[结构化结果](testing/validation/2026-10-07-hermes-live/results.json)。隔离测试会话保留供追溯，其ID在证据中；合成业务账本位于被忽略的 `backend/.local/`，不含上游Token。本次没有修改产品代码，因此没有重跑编译流水线。

### 未验证范围

这证明开发机业务服务到真实Hermes的基础会话链路，不代表手机到业务服务已连通。未重启真实Hermes进程，未验证其崩溃恢复、会话压缩轮换、异步运行/事件/停止/审批、调度、真实工具副作用或家庭Ubuntu部署。问题9的模拟器HAP传输阻塞仍未解决。

## 2026-10-07 · 部署阻塞恢复与设备补验

问题9已解除。主机hdc重启后经历短暂Offline，模拟器也观察到新冷启动进程，连接重建后小文件传输恢复。未修改业务代码/HAP签名，未清除数据；不能将根因单独归于其中一端。

- `device.sh install`：当前主包及ohosTest包均安装成功。
- `device.sh launch`：启动成功，应用进程存在。
- `device.sh test`：**6/6通过**，覆盖导航、阅读缺失数据展示、键盘避让与输入保留、业务预览入口、真实Asset凭据异常与持久化。

[传输证据](testing/validation/2026-10-07-deploy-recovery/transport-restored.txt)、[安装](testing/validation/2026-10-07-deploy-recovery/install.txt)、[启动](testing/validation/2026-10-07-deploy-recovery/launch.txt)、[设备结果](testing/validation/2026-10-07-deploy-recovery/device-test.txt)。本段补齐此前因传输阻塞未执行的设备回归，不扩展为手机连接真实业务服务、真实日历权限或工具执行已验收。

## 2026-10-07 · 编码规范、日志规范与规范门禁

新增 [15 编码规范](15-coding-standard.md) 与 [16 日志打印规范](16-logging-standard.md)，并把可机检条目实现为 `scripts/check-standards.cjs`（31 条规则，`--json` 机读报告），作为 `scripts/verify.sh` 的第一个阶段。`verify.sh` 因此从 9 阶段变为 **10 阶段**，`--skip-build` 从 5 阶段变为 6 阶段。

本轮实际修复（`docs/testing/10-test_record.md` 问题10）：

- 日志域与 tag：`EntryAbility.ets`、`EntryBackupAbility.ets` 从模板默认 `0x0000`/`testTag` 迁移到新增的 `services/Logging.ets`（`LOG_DOMAIN=0x1200` + 13 个已登记 tag）；`PlatformErrors.ets` 从裸字面量迁移到同一常量。
- 隐私：删除 3 处 `JSON.stringify(err|bundleVersion)` 日志，只记录数值错误码/版本号。
- 后端：`backend/server.py`、`backend/service.py` 此前**没有任何日志**，未处理异常静默回 500、事件流中断 `except Exception: pass`、启动横幅 `print`；改为 `logging`（未处理异常记 method/path/异常类型，观测失败与事件流中断记 warning，启动信息走 logger）。
- 测试文件：两个 `List.test.ets` 补文件末尾换行。

验证：`bash scripts/verify.sh --label coding-standards --deny-arkts-warnings` → **10/10 阶段通过**；Node **109**、服务端 **12**、Previewer **10** 全通过；`hap-default`、`hap-ohostest`、`hypium-local` 均 **0 条 ArkTS 告警**；规范门禁 **0 error / 14 warning**（存量告警见 15 §10）。

证据：[结果](testing/validation/2026-10-07-coding-standards/results.txt)、[机读规范报告](testing/validation/2026-10-07-coding-standards/standards.json)、[摘要](testing/validation/2026-10-07-coding-standards/summary.json)。

未验证范围：`stateStyles` 内 `$r` 的历史 jscrash 根因仍未定位（仅列为 `CS-12` 存量告警）；设备侧未重跑（本轮不涉及运行期行为变更，但日志文案与域/tag 变化尚未做设备日志核对）；分支覆盖率门禁（`scripts/coverage.cjs`）与业务点击用例在后续迭代落地，落地前 15 §8.1 的覆盖率下限不代表已达标。

## 2026-10-07（第二轮）· 单元测试重构建、分支覆盖门禁与模拟点击

在规范门禁之后，把"覆盖每个分支"与"模拟点击"变成可执行资产：

- 新增 `scripts/coverage.cjs`：用 `NODE_V8_COVERAGE` 采集六套 Node 用例在 vm 中执行的生产代码，解析 source map 把行号映射回源码，按 [15 §8.1](15-coding-standard.md) 的下限拦截（`core/` 100%/100%，`services/` ≥95% 行/≥90% 块，门禁脚本 ≥90%）。
- 新增 `scripts/test-standards.cjs`：门禁自身 37 条用例（31 条规则各一个最小 fixture + CLI 分支）。
- 新增 `scripts/test-ui-flows.cjs`（F01–F06）：把页面点击建模为轨迹驱动真实交互方法，130 条中文语义断言。
- 新增 `entry/src/ohosTest/ets/test/Flow.test.ets`（U08/U09）：设备端模拟点击，验证计划日期按钮确实改变 `planDate`（通过编辑页读取）、编辑器打开/返回不落盘。
- `verify.sh` 从 10 阶段扩展到 **13 阶段**，`--skip-build` 为 9 阶段。

### 验证结果

`bash scripts/verify.sh --label test-rebuild --deny-arkts-warnings` → **13/13 阶段通过**：

| 项 | 结果 |
|---|---|
| 规范门禁 | 0 error / 14 存量 warning |
| 门禁自测 | 37/37 |
| 覆盖率 | `core` 470/470 行、379/379 块（100%/100%）；`services` 677/680 行（99.6%）、270/272 块（99.3%）；门禁脚本 96.6%/92.9%；0 项不达标 |
| Node 生产用例 | 183（domain 23 / services 45 / workspace 79 / business 30 / ui-flows 6），上轮 109 |
| 服务端 | 12/12 |
| Previewer（本地 Hypium） | 10/10 |
| 编译 | `hap-default`、`hap-ohostest`、`hypium-local` 均 **0 条 ArkTS 告警** |

设备：`bash scripts/device.sh test` → **8/8 通过**（模拟器 API 26；含 U08/U09 两条模拟点击用例）。

### 新发现（均未修改生产代码）

| 编号 | 问题 | 位置 |
|---|---|---|
| 11 | 计划列表页"查看日期"点击前一天/后一天后不刷新（状态已变、显示不同步） | `Index.ets:464`/`:638` |
| 12 | 业务非 200 状态码文案被裸 `catch` 覆盖，HTTP 状态码丢失 | `BusinessClient.ets:27-29` |
| 13 | 缺失 `connection` 字段抛裸 `TypeError`，而非中文领域错误 | `Workspace.ts:263` |
| 14.1 | 日历"查看日期已变化"守卫在任何真实点击路径下不可达（死分支） | `Index.ets:400` |
| 14.2 | 保存成功但连接失败时状态栏丢失"配置已保存"事实 | `Index.ets:246` |
| 14.3 | 重复导入无新增仍触发整快照写盘并提示"已加入 0 条计划" | `Index.ets:402-407` |

详见 [10 问题记录](testing/10-test_record.md) 问题 11–14。

### 未验证与未修复范围

- 问题 11–14 只记录未修复；设备用例因此不断言"列表页输入框跟随日期变化"，也未断言问题 14 的文案与写盘次数。
- 覆盖率仅覆盖可在 Node/注入 mock 下执行的生产代码；`components/*`、两个 ability、`IntegrationCapabilities.ets` 未被 Node 加载（0%，不计入下限），`pages/Index.ets` 以抽取方法方式驱动、行号不可比。
- 设备实测仅在 DevEco 内置模拟器（API 26）完成，真机、权限授予、提醒、真实日历、真实 Hermes 与真实业务服务仍未验收。

证据：[13/13 结果](testing/validation/2026-10-07-test-rebuild/results.txt)、[覆盖率报告](testing/validation/2026-10-07-test-rebuild/coverage.json)、[规范报告](testing/validation/2026-10-07-test-rebuild/standards.json)、[摘要](testing/validation/2026-10-07-test-rebuild/summary.json)、[设备 8/8](testing/validation/2026-10-07-click-flows-device/device-test.txt)、[问题11诊断](testing/validation/2026-10-07-click-flows-diag3/device-test.txt)。
