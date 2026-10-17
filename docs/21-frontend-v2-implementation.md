# HermesEye · V2 前端实施与验证

日期：2026-10-11；分支：`dev`。本轮用户明确授权实施V2，沿用V1业务模型及独立服务协议。设计依据为“前端设计&交互逻辑设计”会话、[14](14-frontend-design-V2.0.md)、[项目规格](modules/17-project-spec.md)和 `docs/design/V2.0/` 原型。原型数据不进入应用。

## 已实施

|区域|生产行为|
|---|---|
|主导航与材质|四入口居中悬浮胶囊，最大374vp、底距18vp；表单/会话/键盘展开时隐藏。语义浅深色、弱模糊、持久实色降级开关|
|今日与事项|短摘要、独立完成框；正文进入完整详情再进需求。取消勾选回todo；日历无完成框。日期与工具单层弹层，编辑可选项折叠|
|保存与撤销|失败保留草稿并显示正文反馈；完成框失败复位；撤销校验服务器/ID/完整对象，防止覆盖之后编辑|
|项目|列表搜索与一个状态筛选；概览/里程碑/行动/复盘；统一＋分流，更多编辑/同步/状态确认，Hermes为单一主要入口|
|阅读|概览卡、书籍与逐条疑问详情、周期设置；真实引用与操作回执，来源授权和百分数进度保持当前规格|
|我的与连接|配置与能力摘要；地址/凭据/高级选项分组，Token不出现在摘要；原安全保存和私网HTTP显式同意仍有效|
|需求会话|Hermes左、用户右，实色长文；固定多行输入与上下文入口，需求/服务器隔离草稿，停止等待不代表取消远端；原操作查询保留|
|消息内容|段落、代码块、粗体、Markdown HTTP(S)链接、管道表格；代码/表格横向滚动，可复制；显式点击才打开系统浏览器，不解析HTML|

`DailyPlanCard`、`ProjectPanel`、`ReadingPanel`负责对象展示；`Index`负责导航与兼容会话，`BusinessPanel`拥有独立历史滚动区及固定输入；`MessageContent`只做展示，外链由 `SystemPresentation` 调系统API。Workspace可选布尔 `solidSurfaces`兼容旧文件，保留原存储版本。

## 实际验证

- Harness：`bash scripts/verify.sh --deny-arkts-warnings --label v2-release-ready`；15/15阶段通过，主包/测试包/本地Hypium均零ArkTS告警；core行/块100%/100%，services行/块99.6%/99.3%，后端77项通过。
- 模拟点击：20组，新增V2-01～04覆盖完成失败、撤销保护、弹层/上下文隔离与消息解析；服务46组、Workspace112组、领域23组、业务31组。
- 设备：在API26模拟器安装未签名主包与ohosTest包，最终12/12通过（Failure 0 / Error 0），含导航、表单、键盘、日期/工具弹层、搜索/筛选、阅读入口与真实Asset Store；阅读专项另2/2通过。已查看原生项目列表及首页底部截图，入口不被底栏遮挡。
- 迭代问题：弹层关闭动画曾清除刚打开的筛选，改在onWillDismiss清理；业务会话返回曾读取已卸载Scroller导致jscrash，改为只读取已挂载公共滚动区，新增模拟回归。首页底部回归未滚动到入口；TestKit布局诊断确认Scroll可滚动，其默认起划点落在悬浮胶囊内。设备用例改用可见内容区手势并检查入口位于导航上方；公共Scroll显式使用父容器剩余高度；导航移除会覆盖圆角的stateStyles，保留原生按钮反馈。
- 本地证据：[15/15门禁](testing/validation/2026-10-11-v2-release-ready/results.txt)、[12/12设备](testing/validation/2026-10-11-v2-release-device/device-test.txt)。证据目录由git忽略，只保留本地；不提交截图或原始日志。

## 尚未证明的范围

当前测试不代表真机签名、真实Hermes联调、阅读外部采集、日历/提醒/Vault授权已验收。平台自动透明度/性能降级尚未接入，现有开关为用户选择；深色原生像素、大字号、读屏、旋转、长历史性能需要专项验收。Markdown为上述受限子集；没有新增流式协议、远端运行取消、自动执行、多Agent或部署能力。完整V1外部能力仍以05与模块实施记录为准。

## 2026-10-11 补充 · 外部能力尝试结果

对上一轮「尚未证明的范围」逐项尝试：

| 能力 | 结论 |
|---|---|
| 手机日历读取 | **模拟器实测成功**：走 V2 弹层路径（工具与来源 → 手机日历 → 授权并刷新），`readCalendarEntries` 返回当天 2 条日程（`2026-10-11 · 2 条日程`），无权限弹窗。真实手机仍取决于用户授权与日历数据。 |
| 华为运动健康 | **未接入**：`IntegrationCapabilities.health = 尚未接入`；SDK 无 HealthKit 公开接口。需要开放资格 + 独立授权 + 新增适配器，属新功能。 |
| 真实 Hermes | **待凭据**：`127.0.0.1:8642` 可达但 `/v1/capabilities` 返回 401；业务服务未运行且缺少 `HERMES_TOKEN`。令牌不入库不入文档，需环境变量注入后再联调。 |

其余（真机签名、阅读外部采集、提醒/Vault 授权、深色/大字号/读屏/旋转/长历史性能）仍未验收。

证据：[日历探测](testing/validation/2026-10-11-calendar-probe/device-test.txt)、[设备 12/12](testing/validation/2026-10-11-v2-device-final/device-test.txt)、[15/15 门禁](testing/validation/2026-10-11-v2-baseline/results.txt)。

## 2026-10-11 补充 · 真实 Hermes 联调通过

上一轮「待凭据」已解除：注入真实 ASCII 上游令牌后，业务服务经 hermes 适配器访问 127.0.0.1:8642 成功——`capabilities.sessions=true`，chat 操作回执 `state=completed` 且回复「联调正常」。真实会话往返证据见 [hermes-live-v2](testing/validation/2026-10-11-hermes-live-v2/)。此前误把占位符当令牌导致 `hmac.compare_digest` 抛非 ASCII 异常，已定位并修复联调脚本的令牌校验与日志透出。


## 2026-10-11 · 应用图标补充

用户要求设计并接入应用图标。以葱青/米白制作眼睛轮廓与负形H，统一应用/入口分层图标和启动资源；设计源稿与导出说明见 [品牌资源](design/brand/README.md)。`app-icon` 门禁15/15、零ArkTS告警，模拟器安装与启动成功。未改变会话、授权或V2页面交互，桌面蒙版与真机像素效果待专项确认。

## 2026-10-17 · 视觉打磨第一轮：尺寸令牌与共享组件收敛

用户确认方向为「视觉打磨」，本轮只做设计令牌资源化与重复模式收敛，**不改页面布局与导航结构**（布局调整另行评审）。

已实施：

|区域|生产行为|
|---|---|
|尺寸令牌|`resources/base/element/float.json` 建立语义令牌：字阶 font_page_title/section/body/aux/small（24/18/16/14/12fp）、圆角 radius_card/field/capsule（16/12/999vp）、间距 space_card_inner/card_gap/section_gap/tight/page_edge/capsule_inner、触控 touch_min 48vp、完成框 control_checkbox 24vp 及胶囊导航四项尺寸；pages 与 components 共 226 处硬编码设计刻度字面量替换为 `$r('app.float.*')`，行高与 2–10vp 微间距保持局部字面量|
|ObjectCard|新增 `components/ObjectCard.ets`：标题＋辅助行＋整卡详情入口的统一概览卡；替换项目卡、书籍卡、需求卡、收件箱记录卡、历史建议卡、能力来源卡与「独立需求 ›」入口共 7 处手写 `Column{}.surface().onClick()`。项目卡标题由 18fp 收敛为 16fp Medium，分隔线与「下一步」标签改为辅助行|
|OptionPicker|新增 `components/OptionPicker.ets`：单选列表，选中行 soft 底＋brand 图文＋Medium，读屏播报「已选中」，不再仅靠「✓ 」前缀区分；收敛需求归属、移动需求、计划编辑所属项目、计划详情三态、项目状态筛选、显示模式、会话上下文引用共 7 处列表；`project-filter-*` 等设备测试 id 经 `idPrefix` 原样保留|
|FilterTabs|新增 `components/FilterTabs.ets`：分段筛选，选中胶囊 soft 底＋brand 图文，与底栏选中语言一致；替换每日计划筛选行（原全部选项同色仅靠 ✓ 区分）|
|一致性修复|首页「今日计划 ›」补 Medium 字重对齐分区标题；「阅读概览」改为全局 link 样式（`home-reading` id 保留）；删除无引用的 `RecordCard` 组件；`WorkspaceAction` 增加可选 `actionId`|

实际验证：`bash scripts/verify.sh --deny-arkts-warnings --label v2-visual-tokens` 15/15 阶段通过，主包/测试包/本地 Hypium 零 ArkTS 告警，证据（仅本地）见 `docs/testing/validation/2026-10-17-v2-visual-tokens/`。逻辑套件 203 组全部通过；`test-ui-flows.cjs` 的 Index.ets/ProjectPanel.ets 切片标记未受影响。

实现约束备忘：ArkUI `@Builder` 只接受 UI 组件语法，选项数组必须由 private 方法构造后传入组件参数，不能在 builder 内写 `const` 声明与 forEach 语句。

尚未证明：本轮未做设备验收——OptionPicker/FilterTabs 的选中态像素、毛玻璃配对（新组件沿用 glass_content 与 BlurStyle.Thin）、CS-12 提示的 stateStyles+$r 模式（沿用既有 WorkspaceAction 写法）需在下一轮设备回归确认；页面布局、顶栏与返回模式保持原样，调整建议待评审后另行实施。
