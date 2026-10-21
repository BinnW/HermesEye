# HermesEye · V1.0 测试与验收计划

更新：2026-10-03（第二轮）。测试围绕 [08 产品范围](../design/08-product-requirements-V1.0.md) 与 [09 页面规则](../design/09-frontend-design-V1.0.md) 设计；模拟器实测问题 1～5（[10](../issues/10-test_record.md)）的修复均有自动回归与手动验收用例。通过事实见 [05](05-release.md)。

## 测试层次与命令
1. DevEco 自带 Node 执行 `scripts/test-domain.cjs`、`scripts/test-services.cjs`、`scripts/test-workspace.cjs`：生产规则、注入平台适配器的失败路径，以及从 `Index.ets` 抽取的生产方法回归（send/notice）与页面源结构守卫。
2. DevEco Hvigor `test`：在 Previewer 执行 `entry/src/test/LocalUnit.test.ets`，验证实际 ArkTS 运行时领域行为。
3. `entry@ohosTest assembleHap`：编译 `entry/src/ohosTest/ets/test/Ability.test.ets`。安装签名主包和测试包后，在前台已打开应用的测试设备执行 UI 与 Asset Store 测试。
4. 真实 Hermes、设备和网络验收：不能用注入适配器或 Previewer 替代。

`bash scripts/verify.sh` 顺序执行 1–3、核对 Hypium 结果行，并把日志与 `summary.json` 落到 `docs/testing/validation/<日期>-<标签>/`；无设备时只记录编译，不写“设备通过”。`bash scripts/test-deveco.sh` 已改为 `verify.sh` 的兼容别名，不再自带一份 DevEco 路径与结果解析。设备侧（安装、ohosTest 执行、hilog）走 `scripts/device.sh`。用例编号（N/S/W/L/U）是稳定标签，新增用例顺延编号，不因执行顺序重排。

### Harness 命令（2026-10-04 新增）

| 命令 | 作用 | 不覆盖什么 |
|---|---|---|
| `bash scripts/doctor.sh` | 环境自检：DevEco 安装位置、SDK API 与工程 `compatibleSdkVersion` 是否匹配、oh_modules、签名配置、hdc 目标、技能目录。`--json` 出机器可读报告，`--strict` 让警告也失败 | 不编译、不安装 |
| `bash scripts/verify.sh` | 统一验证入口：三套逻辑用例 → debug HAP 编译 → ohosTest HAP 编译 → 本地 Hypium，产出证据包 | 不签名、不安装、不跑设备 UI |
| `bash scripts/device.sh` | 模拟器/真机验收：`status` / `install` / `test` / `log` | 不替代权限授予、提醒、真实 Hermes 联调 |

工具链位置由 `scripts/lib/deveco-env.sh` 与 `scripts/lib/deveco-env.cjs` 统一解析（macOS、Windows、Linux 候选项一致，`DEVECO_HOME` 覆盖两者），`doctor.sh` 会交叉核对两套解析结果是否指向同一安装。三套 Node 用例不再硬编码 Windows 路径。`verify.sh` 会汇总每次编译的 ArkTS 告警数；`--deny-arkts-warnings` 可让其变为失败。2026-10-06 问题8修复后主包与设备测试包均为 0 条 ArkTS 告警（历史为 21/1）。本类改动使用 `--deny-arkts-warnings` 门禁，证据见 [问题8最终验证](validation/2026-10-06-issue8-final/results.txt)。

### 设备验收入口与真机预留（2026-10-04 新增）

设备侧统一走 `bash scripts/device.sh`，模拟器与真机**共用同一套子命令与参数**，差异只在签名：

| 子命令 | 通过条件 |
|---|---|
| `status` | 打印目标、机型、API、软件版本、是否已安装、两个 HAP 产物是否就绪、签名状态 |
| `install` | 主包与 ohosTest 包均返回 `install bundle successfully` |
| `launch` | `aa start` 成功后进程仍存活 |
| `test` | 设备 transcript 中 `Tests run` 等于 `Pass` 且 `Failure`/`Error` 均为 0，否则返回 1 |
| `log` | 指定时长内 `hilog` 有输出，写入 `docs/testing/validation/<日期>-device/hilog.txt`；`--app` 只保留本应用进程 |
| `faults` | 列出并拉取 `/data/log/faultlog/faultlogger` 中本 bundle 的崩溃/冻屏日志，打印 `Reason`、`Error message` 与栈顶 3 帧 |

2026-10-04 在 DevEco 内置模拟器（`emulator` / API 26 / 软件版本 7.0.0.107）实测：两个未签名 HAP 均安装成功，应用启动后进程存活，`device.sh test` 得到 `Tests run: 4, Failure: 0, Error: 0, Pass: 4`（含 U04 真实 Asset Store 用例）。证据见 [设备验收](validation/2026-10-04-device/device-test.txt)。

### 日志查看路径（2026-10-05 补充）

开发调试期共四个日志出口，按需要排查的问题选择：

| 出口 | 位置 / 命令 | 适合排查 |
|---|---|---|
| 应用运行日志（实时） | `bash scripts/device.sh log --app --seconds 20` | 交互行为、状态流转、应用自己的 `hilog` 输出 |
| 应用运行日志（DevEco IDE） | DevEco Studio → Log 窗口 → HiLog 标签，按设备/进程过滤 | 与调试器断点配合的交互式排查 |
| 崩溃与冻屏 | `bash scripts/device.sh faults` | 闪退、白屏、无响应；输出直接给 `Reason` 与栈顶 |
| 历史日志（设备侧落盘） | `/data/log/hilog/*.gz`，`hdc file recv` 拉取 | 复现时刻早于开始抓取的场景 |
| 构建/验证日志 | `docs/testing/validation/<日期>-<标签>/*.log` 与 `results.txt` | 编译失败、ArkTS 告警、Hypium 用例失败 |

**务必用 `--app`**：未过滤的 `hilog` 几乎全是系统与应用框架噪音，实测 8 秒内应用自身有效日志仅 9 行。`--app` 通过 `pidof <bundle>` 解析进程号后按 `-P` 过滤；应用未运行时该命令会失败并提示先执行 `launch`，不会静默返回空结果。

当前工程的日志调用集中在 `entryability/EntryAbility.ets` 与 `entrybackupability/EntryBackupAbility.ets`，一律使用 `hilog.info/error`，**domain 为模板默认的 `0x0000`、tag 统一为 `'testTag'`**。该组合过于通用：`-D 0x0000` 与 `-T testTag` 无法把本应用与其他模板工程区分开。**按 pid 过滤（`--app`）是当前唯一可靠的隔离方式**；若后续需要按模块过滤，应给不同模块分配独立 domain 与 tag。

已知故障记录：`/data/log/faultlog/faultlogger` 中存在 2 条 `com.binn.hermeseye` 的 jscrash（2026-10-01，v0.1.0 构建），均为 `TypeError: $r is not callable, $r is undefined`，栈顶指向 `WorkspaceNavigation.ets:22`。用 2026-10-04 的构建重复启动未产生新记录，故判为旧构建的历史问题，**尚未定位根因，也未按修复验证**；证据见 [faultlog](validation/2026-10-05-device/faultlog/index.txt)。

**签名边界**：模拟器镜像放宽了签名校验，接受 `verify.sh` 产出的未签名 HAP；**真机不校验通过，必须签名**。当前 `build-profile.json5` 的 `signingConfigs` 为空，`doctor.sh` 会就此给出 WARN。`device.sh` 已内建保护：目标不是 `emulator` 且无签名配置时，`install`/`test` 直接失败并打印配置指引，不会抛出含义不明的安装错误；加 `--allow-any-target` 可强行尝试。接入真机的步骤（DevEco 自动签名 → 复制 `signingConfigs` → 重新 `verify.sh` → `device.sh status --target <真机序列号>`）与签名材料的 gitignore 约束见 `harmonyos-harness` 技能。

**未验证范围**：真机（无签名材料、当前无设备）、多目标并发选择、`--tag`/`--domain` 过滤在大日志量下的表现、`/data/log/hilog/*.gz` 归档拉取在真机上的权限、模拟器与新签名产物的兼容性。上述状态不代表真机可用。

## 用例总览

| 套件 | 用例数 | 范围 |
|---|---|---|
| `test-domain.cjs`（N 系列） | 23 | 地址、文本、时间、分享上下文、请求/响应协议、旧格式校验 |
| `test-services.cjs`（S 系列） | 45 | HTTP 适配器、连接检测、凭据存储、结构化日历、提醒、旧持久层、键盘避让 |
| `test-workspace.cjs`（W 系列） | 111 | 工作区规则、迁移、隔离、校验、原子存储、连接凭据、生产 send/notice 回归、日历导入、计划与建议、项目扩展字段、页面源守卫 |
| `test-business.cjs`（B 系列） | 31 | 业务副本、协调器、持久意图、HTTP 适配器、业务落盘 |
| `test-ui-flows.cjs`（F 系列） | 16 | 模拟点击的端到端业务流程（导航/计划/非法输入/日历导入/连接保存/发送/项目/阅读身份隔离与周期/业务面板同步与墓碑删除） |
| `test-standards.cjs` | 37 | 规范门禁自身：31 条规则各一个 fixture + CLI 分支 |
| `test-resources.cjs` | 524 断言 | 资源完整性：`$r('app.string/color.x')` 引用存在性、颜色 base/dark 成对、资源文件结构与重名 |
| `backend/tests`（Python） | 77 | SQLite 业务服务、CAS、分页、回环 HTTP、阅读策略/采集/分片/疑问、WeRead 适配器错误路径 |
| `scripts/python-coverage.cjs` | 5 个模块 ≥90% | 后端行覆盖门禁：`sys.settrace` + `dis` 可执行行口径，登记不可达入口 |
| `LocalUnit.test.ets`（L 系列，Previewer Hypium） | 10 | 真实 ArkTS 运行时下的关键领域行为 |
| `Ability.test.ets` + `Flow.test.ets` + `ProjectFlow.test.ets` + `ReadingFlow.test.ets`（U 系列，设备 UI Hypium） | 12 | 导航、阅读缺失态、键盘 UI 回归、真实 Asset Store、计划日期与编辑器、项目检索与表单装配、阅读入口与未连接时隐藏周期控件 |

## N 系列 · 领域规则（test-domain.cjs）
|编号|场景与断言|
|---|---|
|N01|HTTPS 路径规范化与 `/v1` 去重|
|N02|HTTP 需显式开关且仅限内网/回环/Tailscale 地址|
|N03|凭据、查询、片段、缩写/非法 IPv4、超界端口、相对路径、非 HTTP 协议拒绝|
|N04|空白与超长输入拒绝；首尾空白裁剪|
|N05|时间 HH:mm 边界（00:00、23:59 合法；24:00、8:30、12:60 拒绝）|
|N06|未勾选的数据绝不进入分享上下文|
|N07|过期/未来/缺失快照与空日历阻止发送|
|N08|请求保留会话、不修改历史、上限 98 条拒绝|
|N09|有效响应提取|
|N10|401/403/429/500 与无效 JSON、空 choices、空 content 显式失败|
|N11|分享上下文只携带最近 10 条记录|
|N12|无分享上下文时发送裸提示词，不附带 personal_context|
|N13|回复空白拒绝；32000 字上限边界（32000 通过、32001 拒绝）|
|N14|cleanText 恰达上限通过、超一字拒绝（默认 4000 与自定义上限）|
|N15|旧存储版本、损坏记录/消息/提醒拒绝|

## S 系列 · 服务适配（test-services.cjs，注入平台 mock）
|编号|场景与断言|
|---|---|
|S01|对话请求端点、Bearer、禁跳转、禁缓存、传输释放|
|S02|传输失败脱敏、清理、不自动重试|
|S03|缺失凭据零网络操作|
|S04|停止后迟到回复丢弃、传输只释放一次、下次请求可用|
|S05|停止后传输拒绝报告“服务端可能仍在执行”，不重试|
|S06|日历请求 READ_WHOLE_CALENDAR 权限；queryEventInstances 只查今日（清单声明核对）|
|S07|拒绝授权不查询数据并提示恢复路径|
|S08|已授权空日历与拒绝授权文案可区分|
|S09|旧持久层首次加载初始化；Unicode 短写不截断|
|S10|原子替换失败保留旧副本|
|S11|损坏存储加载失败，不静默覆盖|
|S12|键盘 RESIZE_WITH_CARET；导航随实际键盘高度而非焦点显隐|
|S13|挂载时已弹出键盘可识别|
|S14|查窗完成前离开不挂迟到监听|
|S15|重复启动只移除自身监听、忽略旧事件|
|S16|连接检测走 GET `/models` 并携带 Bearer|
|S17|连接检测区分认证失败、HTTP 错误与非模型列表响应|
|S18|空白 Token 在写入安全存储前拒绝|
|S19|空凭据引用读取返回空、不触达后端|
|S20|提醒注册先申请通知；工作日/每天集合映射正确|
|S21|非法提醒输入在任何系统注册前失败|
|S22|取消提醒透传系统标识|
|S23|日程实例保留稳定标识（日历/事件/实例开始）与实际发生时间；无效标识报错|
|S24|昨日/明日日程剔除；多日历合并并按开始时间排序|
|S25|无实例时间回退事件起止；全天标记缺省为 false|
|S26|Asset 锁定/缺失等错误保留安全诊断；删除缺失凭据幂等、其他失败显式抛出|
|S27|文件访问/读取/打开/写入/刷盘/关闭/替换失败保护旧数据；关闭不掩盖写入错误|
|S28|日历授权窗口、列表与实例查询错误区分；失败不伪造空结果|
|S29|通知拒绝不注册提醒、限额不自动重试；取消仅容忍已不存在|
|S30|键盘初始化失败清理已挂监听并保留安全诊断|
|S31|键盘清理失败保留句柄、屏蔽旧回调；已销毁窗口容忍且记录|
|S32|Toast 失败不向业务抛出、不记录业务正文或原始 SDK 文案|
|S33|主题非法输入不调用 SDK；失效上下文诊断保留错误码|

## W 系列 · 工作区（test-workspace.cjs，注入平台 mock）
|编号|场景与断言|
|---|---|
|W01|空空间无伪造书籍、同步时间或运行|
|W02|旧记录/提醒/消息迁移；旧消息建立独立需求；旧文件不删除|
|W03|有效旧连接字段迁移；不虚构凭据、不上传数据|
|W04|损坏旧数据拒绝迁移，不静默变空工作区|
|W05|同名“漫无目的”ID 与历史独立|
|W06|计划/项目恢复已有会话；链接唯一|
|W07|无归属、无效目标不能建孤儿会话|
|W08|重命名/移动保持历史与原事项链接；无效目标拒绝且原名保留|
|W09|服务器切换隔离数据，local 记录不随迁|
|W10|地址规范化（大小写、/v1）；端口与非法主机校验|
|W11|Tailscale 100.64/10 需 HTTP 显式允许；边界公网地址拒绝|
|W12|跨日状态计数；无效日期（含 2 月 30 日）拒绝、闰年合法|
|W13|纯正文记录可保存；半区间、倒序、未来区间拒绝|
|W14|日报按发生日汇总、标记补记与覆盖未知|
|W15|本机历史不受旧 100 条上限约束|
|W16|重复标识、悬空归属、负数统计拒绝保存|
|W17|深拷贝与持久快照完全隔离（发送/编辑不污染内存原稿）|
|W18|已提交发送只存在于新快照——会话页必须渲染最新快照（问题 2 数据层契约）|
|W19|activeServer 指向不存在空间时读取与校验均失败|
|W20|连接配置与活动远端空间不匹配拒绝|
|W21|指向已删除会话的链接响亮失败，不静默重建|
|W22|空白重命名拒绝且身份保留|
|W23|纯正文记录按保存日期进入日报，标注“未标明事件区间”|
|W24|畸形历史地址不迁移连接但数据保留在本机|
|W25|迁移按协议补默认端口（443/80）并保留私网 HTTP 选择|
|W26|迁移原子：v1 源文件保留，v2 生成|
|W27|rename 失败/零字节写入不破坏旧持久数据；恢复后可再保存|
|W28|损坏 v2 不回退旧数据、不覆盖|
|W29|凭据跨实例重读；业务 JSON 无 Token|
|W30|安全存储失败不落明文、不报已保存|
|W31|配置失败撤销新凭据、保留旧凭据|
|W32|非法连接在触达安全存储前拒绝|
|W33|重复保存连接恰好替换旧凭据一次（无泄漏资产）|
|W34|空白 Token 不产生临时凭据、不保存工作区|
|W35|生产 send()：等待期间已有临时气泡与 pendingKey；重复点击只发一次；成功恰提交一组问答并清空草稿（问题 3）|
|W36|生产 send()：网络失败保留输入、不自动重试、sending 复位（问题 3）|
|W37|生产 send()：保存失败回复留内存、临时气泡不残留、ready 置否阻止继续写入（问题 3）|
|W38|生产 send()：失败后就地保留尝试内容与错误，气泡不串会话（问题 3）|
|W39|生产 send()：成功时若已切走会话，只清原会话草稿，不触碰当前输入（问题 3）|
|W40|日历导入只导所选项、同名不同实例不混淆、重复导入跳过、来源与项目保留（问题 5）|
|W41|副本导入不影响已保存数据；无效日期/项目拒绝（问题 5）|
|W42|空选择不导入；去重按空间独立，不跨空间拦截（问题 5）|
|W43|非法 calendarSource（倒序/空 key/非布尔）拒绝保存；无来源旧计划兼容（问题 5）|
|W44|超长日程标题整体导入失败，不产生部分持久化（问题 5）|
|W45|生产 notice()：1.5 秒内相同提示去重；普通 3 秒、错误 5 秒；超时后可再提示（问题 4）|
|W46|页面源守卫：会话页从最新 @State 读取消息，临时气泡位于历史之下、输入区之上（问题 2/3）|
|W47|页面源守卫：操作反馈经 showToast，无顶部残留提示块（问题 4）|

## L 系列 · Previewer Hypium（LocalUnit.test.ets）
|编号|场景与断言|
|---|---|
|L01|“漫无目的”会话 ID 与历史独立（= W05）|
|L02|计划链接恢复同一会话；移动保留历史（= W06/W08）|
|L03|切换服务器不共享 local 数据（= W09）|
|L04|当日统计只计明确状态（= W12）|
|L05|深拷贝不污染持久快照（= W17）|
|L06|已提交发送必须渲染新快照（= W18，问题 2 契约）|
|L07|悬空链接响亮失败（= W21）|
|L08|日历导入去重、来源与项目保留（= W40，问题 5）|
|L09|非法 calendarSource 拒绝、旧计划兼容（= W43，问题 5）|

## U 系列 · 设备 UI Hypium（Ability.test.ets）
|编号|场景与断言|
|---|---|
|U01|四主入口可达，导航控件 ID 稳定|
|U02|阅读缺失态展示，不伪造统计|
|U03|键盘 UI 回归：导航隐藏/恢复、滚动区收缩、多行输入、草稿保留（问题 1）|
|U04|真实 Asset Store 跨实例读写|
|U06|真实 Asset Store 缺失凭据显式失败；删除缺失别名幂等，错误不暴露别名|
|U07（待专项设备验收）|用户拒绝／撤销日历与通知权限：不查询日程或注册提醒，显示恢复提示；保留原权限设置，验收后恢复。当前仅有 S07/S28/S29 注入验证，未计为设备通过|
|U05（待启用）|会话页发送后原地刷新、临时气泡位置（问题 2/3）。需要可达 Hermes 或桩服务；启用前按 D13-②③ 手动验收|

## 模拟器实测问题回归总表
|问题|状态|自动回归|手动/设备验收|
|---|---|---|---|
|1 键盘遮挡|已修复，竖屏回归通过|S12–S15、U03|D13-①|
|2 会话页不刷新|代码已修复|W17、W18、W46、L05、L06|D13-②、U05（待桩服务）|
|3 发送气泡与加载位置|代码已修复|W35–W39、W46|D13-③、U05（待桩服务）|
|4 操作反馈 Toast|代码已修复|W45、W47|D13-④|
|5 日历日程导入计划|代码已修复|S06–S08、S23–S25、W40–W44、L08、L09|D13-⑤|
|6 每日计划结构重组|未实施，待方案确认|实施时先补领域/持久化用例（编辑延期保持 ID 与链接）|按 [10](../issues/10-test_record.md) 问题6 回归设计执行|

## 设备与端到端验收矩阵（未通过不得勾选）
|编号|需求|操作与通过条件|
|---|---|---|
|D01|H01–H05|四入口与首页顺序正确；空态可开始；不同需求不串消息，返回保留位置|
|D02|H04、C06|草稿跨页面/主题保留，跨服务器隔离；保存失败可恢复；无未加载0值伪统计|
|D03|C01–C03、C07|测试不保存，离线保存成功；锁屏失败不降级明文；杀进程后安全重读Token|
|D04|C04–C06|服务端重启恢复需求/历史；第二客户端同步；断线游标恢复；冲突不静默覆盖|
|D05|R01–R05|真实微信读书字段核对，五项指标齐全；原文引用、周总结去重、IMA写入和定时运行可追溯|
|D06|P01–P05|日历授权拒绝/撤销；重要会议规则；AI建议依据与确认采纳；计划强提醒直达|
|D07|E01–E05|周期时段/遗漏/补记、精力量表、熄屏强提醒、固定模板日报与次日反馈|
|D08|B01–B09|双Vault读写边界、多项目多会话、实际多Agent事件、检查/成果/部署、停止回执|
|D09|D01–D04|健康支持资格与数据项；独立读取/分享/自动化授权及撤销，过期与刷新可见|
|D10|视觉|320vp、600vp、840vp、横屏、键盘、大字号、深浅色、长中文与读屏|
|D11|系统提醒|通知拒绝、创建补偿、取消失败、锁屏、杀进程、重启、时区与免打扰|
|D12|发行|签名安装、旧版本升级迁移、备份边界、日志无凭据、资源与性能验收|
|D13|模拟器问题 1–5 复测|① 键盘：连接表单、会话、记录、计划各页逐框输入，键盘开合草稿与滚动位置保留。② 会话刷新：三入口进入会话→发送→回复原地出现；连续两轮；返回重进一致；杀进程历史完整。③ 发送交互：气泡立即出现且加载/停止在其下方；等待中重复点击只发一次；断网/停止/保存失败保留输入或回复、不重发。④ Toast：滚动到底部操作可见反馈；键盘下不挤占布局；相同提示短时不重复；持续业务状态不变成 Toast。⑤ 日历导入：普通/全天/重复日程展示正确；单选多选导入、重复导入跳过、同名区分；未确认不改计划；保存失败无部分写入；跨空间隔离；撤销权限明确报错。逐项记录于 [10](../issues/10-test_record.md)|

设备自动用例当前覆盖导航、阅读缺失表达、键盘表单回归、真实 Asset Store 跨实例读写。其余按矩阵实测并记录设备/系统、操作、实际结果及证据。没有设备时，只记录测试包编译，不能写“设备通过”。

2026-10-06 新增 W48：生产 `notice()` 在 Toast 失败时不写入去重状态；SDK 恢复后相同提示仍可显示。问题8采用 96 组 Node、9 项本地 Hypium、U01–U04/U06 和零 ArkTS 告警门禁组合验证，设备事实见 [05](05-release.md)。

## 2026-10-07 · 业务服务与客户端基础测试

`verify.sh` 在原三套逻辑测试之后新增 `logic-business`（生产 BusinessSync/Coordinator/Client）及 `backend-service`（Python 3.10+、SQLite、临时回环 HTTP）。2026-10-07 又新增首个 `standards` 阶段（编码与日志规范静态门禁），完整流水线为10阶段，`--skip-build` 会运行规范门禁与全部五个逻辑/服务阶段；需要允许监听临时回环端口。服务端测试仅注入 Hermes，不访问真实服务器。

### 2026-10-07 · 编码规范、日志规范与规范门禁

规范文本：[15 编码规范](../design/15-coding-standard.md)、[16 日志打印规范](../design/16-logging-standard.md)。可执行门禁 `node scripts/check-standards.cjs`（31 条规则，`--json` 出机读报告，`--list-rules` 出清单）已作为 `verify.sh` 第一阶段，`error` 级违规直接失败。

本轮整改的实际缺陷（均为机检首次暴露）：

| 问题 | 位置 | 修复 |
|---|---|---|
| 日志使用 DevEco 模板默认域与 tag，无法按应用/模块过滤 | `EntryAbility.ets`、`EntryBackupAbility.ets` | 迁移到 `services/Logging.ets` 的 `LOG_DOMAIN=0x1200` 与 `LogTag.Ability/Backup` |
| 日志打印原始错误对象（`JSON.stringify(err)`），可能带路径与正文 | `EntryAbility.ets`（2 处）、`EntryBackupAbility.ets`（1 处） | 只打印数值错误码 / 版本号 |
| 平台失败日志域为裸字面量 `0x1200`、tag 为 `'HermesPlatform'`，未登记 | `PlatformErrors.ets` | 使用 `LOG_DOMAIN` + `LogTag.Platform` |
| 后端完全没有日志：未处理异常静默回 500，事件流中断 `except Exception: pass`，启动横幅用 `print` | `backend/server.py`、`backend/service.py` | 增加 `logging`：未处理异常记录方法/路径/异常类型；事件流中断与观测失败记 warning；启动横幅改 `logger.info` |
| 两个 `List.test.ets` 缺少文件末尾换行 | `entry/src/test/`、`entry/src/ohosTest/ets/test/` | 补换行 |

门禁发现的存量 `warn`（不阻断，见 [15 §10](../design/15-coding-standard.md)）：`stateStyles` 内使用 `$r` 3 处（历史 jscrash 可疑模式）、超 200 字符长行 9 处、单类型文件名与类型名不一致 1 处。

证据：[10/10 阶段通过](validation/2026-10-07-coding-standards/results.txt)、[机读规范报告](validation/2026-10-07-coding-standards/standards.json)、[摘要](validation/2026-10-07-coding-standards/summary.json)。`hap-default`、`hap-ohostest`、`hypium-local` 均为 0 条 ArkTS 告警。

重点回归：重复提交/重启去重、CAS 双端竞争、删除墓碑分页、身份切换拒绝上传、冲突双版本、游标与对象原子落盘、失败保留 outbox、意图保存失败不发请求、未知执行只查原操作、会话轮换和停止非终态。Previewer 增加业务副本离线意图测试。

设备验收补充：我的→业务预览；独立凭据连接；离线新增计划/重启可见；同步确认；双客户端冲突选择；断网发送后查询原操作。回环服务必须先由操作者配置安全转发，不能将手机的 localhost 当开发机地址。未执行则明确记为待验收。

## 2026-10-07（第二轮）· 单元测试重构建、分支覆盖门禁与模拟点击

本轮把"测试是否覆盖每个分支"从人工判断变成可执行门禁，并把"模拟点击"落成两层用例。

### 新增阶段与工具

| 工具 | 作用 | 接入 |
|---|---|---|
| `scripts/coverage.cjs` | `NODE_V8_COVERAGE` 采集六套 Node 用例在 vm 中执行的生产代码，解析 TypeScript source map 把行号映射回源码；`--verbose` 列出每个未覆盖分支，`--json` 出机读报告 | `verify.sh` 的 `coverage` 阶段 |
| `scripts/test-standards.cjs` | 门禁自身的 37 条用例：31 条规则各一个最小 fixture + CLI 分支（`--help`/`--list-rules`/未知参数/`--json`/`--quiet`） | `standards-self-test` 阶段 |
| `scripts/test-ui-flows.cjs` | F 系列：把页面点击建模为轨迹（`click 标签`），断言业务状态与持久化，不依赖设备 | `logic-ui-flows` 阶段 |
| `entry/src/ohosTest/ets/test/Flow.test.ets` | U08/U09：设备端模拟点击（计划日期按钮改变编辑页 planDate、编辑器打开/返回不落盘） | `device.sh test` |

`verify.sh` 因此从 10 阶段变为 **13 阶段**（`standards`、`standards-self-test`、`coverage`、五套逻辑、`backend-service`、两个编译、`hypium-local`、`hypium-result`），`--skip-build` 为 9 阶段。

### 覆盖率结果（2026-10-07，`--deny-arkts-warnings`）

| 范围 | 行 | 块 | 下限 |
|---|---|---|---|
| `core/*.ts` | 470/470 **100%** | 379/379 **100%** | 100% / 100% |
| `services/*.ets` | 677/680 **99.6%** | 270/272 **99.3%** | ≥95% / ≥90% |
| `scripts/check-standards.cjs` | 588/609 **96.6%** | 224/241 **92.9%** | ≥90% / ≥90% |

未达 100% 的两处是 V8 块覆盖的固有伪影：`BusinessClient.ets:29-30`、`HermesClient.ets:39` 是 `catch { throw ... }` 与 `finally` 之间的空 fall-through 块，控制流不可能到达，不应用无意义用例去凑（口径说明见 [15 §8.1](../design/15-coding-standard.md)）。

### 用例增长与回归重点

- Node：23 + 45 + 79 + 30 + 6 = **183** 条生产用例（上轮 109），另加门禁自身 37 条；后端 12 条；Previewer 10 条。
- 新增覆盖的重点：`savePlan`/`removePlan`/`planSuggestions`/`adoptPlanSuggestion`/`shiftDay` 的全部分支（`calendarBusyMinutes` 已于 2026-10-17 随日历占用标注删除而移除）；`validateWorkspace` 的 12 组结构校验；业务副本的 CAS、游标回退、删除墓碑、意图不匹配、落盘短写/rename 失败；凭据与日历错误码文案分支；键盘与提醒的清理失败分支。
- 模拟点击流程（F01–F06）：导航与草稿保留、计划完成/恢复与快照隔离、非法计划输入不落盘、日历导入去重与日期变化拒绝、连接保存失败不覆盖旧凭据、等待中重复点击只发一次、失败后保留输入。
- 设备点击（U08/U09）：计划日期按钮确实改变 `planDate`（通过编辑页读取），编辑器打开/返回全程不落盘；模拟器 API 26 实测 **8/8 通过**。

### 本轮发现并记录的实现问题（均未修改生产代码）

| 问题 | 位置 | 结论 |
|---|---|---|
| 11 列表页"查看日期"点击前一天/后一天后不刷新 | `Index.ets:464`/`638` | 状态正确、显示不同步（编辑页取到次日，列表输入框仍显示当日）；`TextInput({ text })` 在 ArkUI V1 下不回填，修复方案待确认 |
| 12 业务非 200 状态码文案被裸 `catch` 覆盖 | `BusinessClient.ets:27-29` | 拒绝重试语义正确，但 HTTP 状态码永远到不了调用方与日志 |
| 13 缺失 `connection` 字段抛裸 `TypeError` | `Workspace.ts:263` | 损坏快照无法得到"连接配置损坏"这类中文领域错误 |

详见 [10 问题记录](../issues/10-test_record.md) 问题 11–13。

### 未验证范围

- 问题 11–13 只记录、未修复，因此设备用例不断言"列表页输入框跟随变化"，也没有针对后两项的失败文案断言。
- 覆盖率只覆盖"能在 Node/注入 mock 下执行"的生产代码：`components/*`、两个 ability、`IntegrationCapabilities.ets` 未被 Node 用例加载（0%，不计入下限），由设备用例与人工验收覆盖。
- `pages/Index.ets` 只以"抽取方法"方式被 F 系列与 W 系列驱动，行号不可比、不计入覆盖率；页面渲染与真实手势仍靠设备用例。
- 设备实测只在 DevEco 内置模拟器（API 26）完成，真机未验证；权限、提醒、真实日历与真实 Hermes 仍不在上述证据范围内。

证据：[13/13 阶段结果](validation/2026-10-07-test-rebuild/results.txt)、[覆盖率报告](validation/2026-10-07-test-rebuild/coverage.json)、[规范报告](validation/2026-10-07-test-rebuild/standards.json)、[设备 8/8](validation/2026-10-07-click-flows-device/device-test.txt)、[问题11诊断](validation/2026-10-07-click-flows-diag3/device-test.txt)。

## 2026-10-09 · 项目模块验证边界

依用户本轮明确要求，开发过程中不新增测试用例，未修改覆盖率下限。新增Project扩展字段校验、保存/状态/里程碑/复盘/摘要规则无新增行为用例，现有coverage会报告未覆盖分支，不能宣称全门禁通过。替代信号为现有逻辑套件、ArkTS编译与设计原型检查；它们不足以验证新规则全部成功/失败路径。设备与真实Hermes尚未验证；当前能力与缺口详见[18实施记录](../modules/projects/18-project-implementation.md)。

## 2026-10-09 · 项目模块用例补充

工作区新增项目模块（`core/Workspace.ts` 项目扩展字段与生命周期规则、`components/ProjectPanel.ets`、`Index.ets` 项目页与路由、`string.json` +204 行）后，按改动补充三层用例，并把覆盖率恢复到门禁要求。

| 层 | 新增内容 | 数量 |
|---|---|---|
| Node 单元 | `scripts/test-workspace.cjs` 项目规则用例：`ProjectDraft` 默认值、`validateProjectDetails` 全字段边界、`projectKindLabel`/`projectStatusLabel`、`projectDraft`、`saveProject`（新建/更新/归档拒绝/必填校验）、`changeProjectStatus`（暂停/恢复/达成/归档 + 达成依据复盘）、`addProjectMilestone`/`setProjectMilestone`/`addProjectReview`、`projectBrief` 缺省文案与截断、`validateWorkspace` 集成 | +30（79→109） |
| Node 流程 | `scripts/test-ui-flows.cjs` F07 项目列表（状态筛选、搜索命中名称/目标、任务摘要、推进目标草稿）与 F08 项目详情（新建、里程碑增删切换、复盘、达成、暂停、归档、归档后拒绝写入） | +2（6→8） |
| 资源自动化 | 新增 `scripts/test-resources.cjs`（408 条断言）：引用的 `app.string`/`app.color` 必须存在、`app.color` 必须 base/dark 成对、资源文件不得重名、配置里的 `$string:`/`$color:` 也纳入扫描 | 新套件 |
| 设备 UI | 新增 `ProjectFlow.test.ets`：项目列表检索/筛选/空态；新建表单渲染与"返回不落盘"；并修正键盘用例到新表单 id（`project-name`/`project-goal`/`project-save`） | +2（8→10） |

### 覆盖率结果（`--deny-arkts-warnings`）

| 范围 | 行 | 块 |
|---|---|---|
| `core/*.ts` | **590/590 100%** | **479/479 100%** |
| `services/*.ets` | 677/680 99.6% | 270/272 99.3% |
| `scripts/check-standards.cjs` | 614/647 94.9% | 228/251 90.8% |

零项不达标；`hap-default`、`hap-ohostest`、`hypium-local` 均 0 条 ArkTS 告警；规范门禁 0 error / 13 warning。

### 设备层取舍（诚实记录）

完整的"新建 → 里程碑 → 复盘 → 归档"链路**不在设备层执行**：模拟器上新建表单中段字段会被软键盘遮挡，TestKit 的 `scrollSearch` 在这些字段上会长时间阻塞（实测两次 60 秒超时，并连带让后续用例报 `uitest-api does not allow calling concurrently`）。该链路改由 Node 层 F08 用真实 `ProjectPanel`/`Workspace` 规则确定性覆盖；设备层只验证入口可达、必填字段与类型按钮渲染、返回不落盘。这与仓库既有原则一致：逻辑用例优先放无设备的 Node 套件，设备层只补 UI 装配与系统能力。

### 未验证范围

- 设备层未覆盖：项目新建提交、里程碑与复盘写入、状态流转与归档确认的实际落盘（Node 已覆盖，设备未验）。
- 未验证大字号、320vp、读屏与深色主题下的项目页表现（沿用 09 设计约束，仍待设备核验）。
- 项目与 Hermes 的持续交互、远端 multi-agent 执行仍是协议草案，无自动化用例。

证据：[14/14 阶段结果](validation/2026-10-09-project-module-tests/results.txt)、[覆盖率报告](validation/2026-10-09-project-module-tests/coverage.json)、[设备 10/10](validation/2026-10-09-project-module-device/device-test.txt)。

## 2026-10-11 · V1 项目/阅读新增回归

- Node core：真实 1%/null 进度、损坏来源/问题副本拒绝、旧资料保留、复盘预览，以及项目未定义状态转移拒绝/重复达成去重/缺标准提示。core 仍执行 100% 块/行门禁。
- Node F09：驱动 ReadingPanel 的连接、身份隔离、原子缓存失败、可见授权范围保存后采集、明确来源问题与请求关联；F10：生产项目业务方法的完整投影、修订和独立 Need。BusinessClient 覆盖全部阅读端点与方法。
- Python：完整来源分页/游标/升级、真实进度、完整采集后发布、采集批次去重/失败/重启未知、长笔记分片、旧资料保留、周期暂停与重启、原文引用、同书问题隔离、超时不重放、真实回环 HTTP 路由；完整项目投影、非法条目与 CAS。
- 设备 ReadingFlow：阅读连接控件可达，未连接不自动显示采集操作；既有项目检索/表单、四入口、键盘及系统用例继续运行。此用例不向真实微信读书或 Hermes 发请求；完整填写链路仍用 Node F08，设备限制沿用前文。

实际结果以 05/模块交付记录为准，不能从注入来源或 API 26 模拟器推断真实来源/API 24 真机已验收。

## 2026-10-11 · 阅读/业务模块用例补充（组件分支与后端覆盖）

工作区新增阅读模块（`core/Reading.ts`、`components/ReadingPanel.ets`、`backend/reading.py`、`Index.ets` 阅读页）并改动了业务面板与后端 store/service/server。仓库已有契约级用例（F09、W 系列阅读断言、Python 37 条），但**组件分支覆盖偏低、后端没有覆盖度证据**，本轮补齐这两块。

| 层 | 新增内容 | 结果 |
|---|---|---|
| Node 流程（F11–F16） | 阅读面板（快照校验/连接前置/身份隔离、周期与提问边界、可见范围授权）、业务面板（本机副本与身份、计划入队与墓碑删除、同步失败保留 outbox 与重建） | 10→**16** 条；`ReadingPanel`/`BusinessPanel`/`ProjectPanel` 在切片可达范围内 **块与行 100%**（未覆盖分支 0） |
| 后端用例（+40） | `test_reading.py`：配置边界/31 本/类型与时区非法、pending 回填、collections 上限、条目重复与容量、撤销同意、周期复用与指纹变化、并发锁释放、tick 失败落库、worker 生命周期、分片 offset 与元数据 413、WeRead 1MiB 上限与 100 页 for-else；`test_service.py`：store 边界与 ID 复用、submit 会话重建与上游非法、run 采集与 gap、hermes 重定向/传输/事件流、阅读与通用路由鉴权与异常映射 | 37→**77** 条 |
| 后端覆盖门禁（新） | `scripts/python-coverage.cjs`：临时 Python 驱动 + `sys.settrace`/`threading.settrace`，分母用 `dis.findlinestarts` 取真正可执行行；`serve` 入口 38 行显式登记为不可达 | `hermes.py` 61/61、`reading.py` 299/299、`server.py` 100/100、`service.py` 95/95、`store.py` 200/200，**全部 100%** |
| 设备 UI（+1） | `ReadingFlow.test.ets` 新增「首页→阅读概览→未连接时隐藏周期/采集/提问控件」 | 11→**12** 例，模拟器 **12/12 通过** |

### 覆盖率结果（`--deny-arkts-warnings`）

| 范围 | 行 | 块 |
|---|---|---|
| `core/*.ts` | 624/624 **100%** | 525/525 **100%** |
| `components/*.ets`（切片可达范围） | 166/166 **100%** | 87/87 **100%** |
| `services/*.ets` | 690/693 99.6% | 273/275 99.3% |
| `scripts/check-standards.cjs` | 586/607 96.5% | 224/241 92.9% |
| `backend/*.py` | 755/755 **100%**（排除已登记不可达 38 行） | — |

`verify.sh` 因此变为 **15 阶段**（新增 `backend-coverage`），`--skip-build` 为 11 阶段；三处编译 0 条 ArkTS 告警，规范门禁 0 error / 13 warning。

### 组件覆盖的口径（诚实标注）

组件文件的覆盖分母来自「VM 实际加载的切片偏移 ↔ 整文件 source map」映射，`build()`/`@Builder`/`@Styles` 等 ArkUI 声明区不能作为普通类转译，天然不在被测范围内。因此上表 100% 是**被测切片可达范围**内的 100%，不代表整文件逐行；渲染与可见性仍由设备用例与人工验收覆盖。

### 本轮发现并记录的问题（详见 [10 问题记录](../issues/10-test_record.md) 问题16）

- 后端：失败周期在元数据校验前就发布了新副本（`reading.py:188` 早于 `:193`）；2000 条/500KB 容量边界只校验本次入参，合并历史后可越界；`Reading.start()` 不幂等且 `stop()` 后无法重启。
- 客户端：阅读周期 1–720 未在本地校验（服务端才拒绝）；未勾选同意时「一键采集」未禁用；提问片段未校验属于选中原文。
- 业务面板：「仅已连接可用」只由 `build()` 的 `.enabled()` 承载，方法层无守卫。

### 未验证范围

- 真实微信读书/Hermes 来源、家庭部署、手机网络、长时间周期实跑与大数据容量仍待联调；本轮全部为注入实现。
- 设备层仍未覆盖完整表单落盘链路（沿用上一轮记录的限制）；深色、大字号、320vp 与读屏未在项目/阅读页验收。
- 不可达登记只有 `backend/server.py` 的进程入口；其余文件无豁免。

证据：[15/15 阶段结果](validation/2026-10-11-reading-tests/results.txt)、[ArkTS 覆盖率](validation/2026-10-11-reading-tests/coverage.json)、[后端覆盖](validation/2026-10-11-reading-tests/backend-coverage.json)、[设备 12/12](validation/2026-10-11-reading-tests-device/device-test.txt)（目录仅本地保留）。


## 2026-10-11 · V2 回归补充

|用例|生产方法断言|
|---|---|
|V2-01|独立完成框，勾选/取消、保存失败复位、只读；2026-10-17 起日历事项同样可勾选完成|
|V2-02|撤销恢复原状态；对象已变更、删除、空间变化及保存失败保护|
|V2-03|弹层返回、按需求/服务器隔离上下文与草稿、项目分区恢复|
|V2-04|消息代码块、表格、粗体、显式安全链接及原样HTML文字|

`node scripts/test-ui-flows.cjs`现20组。服务新增外链scheme/凭据/失败脱敏；Workspace覆盖旧文件和实色偏好校验。设备12项改用V2控件：日期、工具弹层、检索/筛选、折叠表单、隐藏导航、阅读入口和键盘。截图写应用沙箱cacheDir，经hdc导出；不可写/data/local/tmp。完整保存链路由生产规则测试覆盖，设备只读用例不冒充真实端到端验收。

待专项：大字号、旋转、读屏、深色原生像素对照、长历史性能、真实后端会话、透明度平台自动降级。

## 2026-10-11 · V2 交互路径遍历矩阵

按 [14 V2 设计](../design/14-frontend-design-V2.0.md) 的章节，把交互路径映射到已落地的用例，确认遍历完整、无空转路径。

| 设计章节 / 交互路径 | Node 流程用例 | 设备用例 | 覆盖结论 |
|---|---|---|---|
| §3 悬浮胶囊导航、弹层统一 | F01（导航/路由历史）、V2-03（模态返回/草稿/上下文隔离） | 设备导航回归、首页底部入口不被遮挡 | ✅ |
| §4 每日计划：完成/进行中/恢复、详情编辑、日历与建议单独承载 | F02（三态持久化）、F03（非法拒绝）、V2-01（完成框仅成功确认/失败复位/日历事项可勾选）、V2-02（撤销保护）、F04（日历导入勾选/去重/日期变更拒绝） | 设备日期/工具弹层、键盘 UI | ✅ |
| §4.5 日历读取 | —（`NativeData` 由 test-services 注入 mock 覆盖） | **真实读取探测：返回 2 条日程** | ✅（模拟器） |
| §5 今日/记录/日报 | F01、F03 | 设备表单/键盘 | ✅ |
| §6 项目/需求/Agent | F07/F08/F10/F15、V2-02（撤销跨空间） | 项目检索/筛选/表单 | ✅ |
| §6 需求会话（Hermes 左/用户右、上下文、固定输入） | F06（发送去重/失败保留）、F10/F13/F14/F16（业务同步/墓碑/outbox） | 设备业务连接 | ✅（含真实 Hermes 待补，见下） |
| §7 阅读与自动整理 | F09/F11/F12、F16 | ReadingFlow（入口/未连接隐藏控件） | ✅（真实来源采集未验收） |
| §7 消息正文解析（段落/代码/粗体/表格/链接，不解析 HTML） | V2-04 | — | ✅ |
| §8 我的/连接/个人数据、Asset Store | F05（连接保存）、F13（身份隔离） | 设备真实 Asset Store | ✅ |

**未覆盖/待补**：真实 Hermes 会话往返（受凭据阻塞，`/v1/capabilities` 401）；华为运动健康（`IntegrationCapabilities.health=尚未接入`，SDK 无公开接口）；提醒/Vault 授权、深色/大字号/320vp/读屏/旋转。这些不在"交互路径遍历"范畴内，属外部能力或专项验收。

## 2026-10-21 · 文档分类与索引回归

文档重组专项检查：总索引和设计、模块、计划、问题、测试五类索引必须存在；从 `docs/README.md` 沿 Markdown 链接应能到达每篇文档。普通断链报错，孤立文档告警；`docs/testing/validation/` 与旧 `docs/validation/` 为本地证据，不扫描，也不要求新克隆中存在。不要把名称近似的普通目录当作证据豁免。

本轮使用临时 fixture 验证嵌套/循环索引、孤立文档、普通断链、缺分类索引、缺总索引、本地证据缺失、证据内容跳过及近似目录仍报错，8/8 通过；仓库文档结构审计覆盖 37 篇且 0 finding，扩展 Markdown 链接扫描覆盖 41 篇且无断链。规范门禁自测 37/37；命令及限制见 [13](13-harmony-harness.md)，实际结果见 [05](05-release.md)。本轮未执行应用构建、业务全量回归或设备验收。
