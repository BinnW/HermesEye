# v0.1.0 开发预览 · 自测与发布报告

日期：2026-09-24。此报告区分本机验证、真实设备验证与正式发行。

## 已实现
- 今日概览、对话、个人数据、提醒任务、连接设置五个 ArkUI 页面。
- 本地记录创建/删除与会话保存；原子 JSON 文件存储，加载异常时禁止覆盖。
- 可配置 Hermes 文本客户端、认证检测、错误状态、手动重试；无内置假回复。
- 设备电量/时间、按需授权的今日日历、发送前选择与预览、10 分钟快照有效期。
- 每天/工作日系统代理提醒创建与取消；任务可带入对话手动发送。
- Token 仅驻留内存，未写入配置；关闭模板备份扩展；禁用 HTTP 重定向。

## 实际验证记录
|检查|结果|说明|
|---|---|---|
|领域规则测试|11 组通过|执行生产 Domain.ts：地址/输入/时间/分享隔离/过期/响应/损坏数据|
|服务适配器测试|6 组通过|执行生产服务代码并注入平台适配器：网络资源释放、无自动重试、凭据校验、Unicode 短写、原子替换失败、损坏数据|
|ArkTS 与资源编译|通过|HarmonyOS 6.1.1 / API 24|
|Debug HAP 打包|通过|生成 unsigned HAP；无签名配置|
|Release HAP 打包|通过|BUILD SUCCESSFUL；BuildProfile 确认 release / DEBUG=false|
|设备连接检测|无设备|`hdc list targets` 返回 Empty|
|Hypium / UI / 真机提醒|未运行|需要已签名安装与设备|
|真实 Hermes 联调|未运行|未提供实例版本与可达接口|
|应用市场或正式安装发布|未完成|缺少签名与设备验收，尚未提交市场|

注意：适配器测试不是实际鸿蒙系统 API 测试，也不是对用户 Hermes 服务器的网络测试。现有模板 Hypium 用例未纳入通过数量。编译存在系统 API “可能抛出异常”静态提示，业务入口已捕获 Promise 失败并显示反馈；设备错误分支仍需验证。

## 本机构建与自测
在工程根目录运行（DevEco 安装路径不同时传入参数或设置 DEVECO_HOME）：
```powershell
& 'D:\dev-tools\DevEco Studio\tools\node\node.exe' scripts/test-domain.cjs
& 'D:\dev-tools\DevEco Studio\tools\node\node.exe' scripts/test-services.cjs
.\scripts\build.ps1 -Mode release
```

构建依赖 DevEco 内置 Node、Java、SDK 和 Hvigor，首次运行需允许写入用户 Hvigor 缓存。Java 路径由脚本补齐。HAP 默认位置：`entry/build/default/outputs/default/entry-default-unsigned.hap`。

本次归档产物：[`HermesEye-0.1.0-release-unsigned.hap`](../../../releases/v0.1.0/HermesEye-0.1.0-release-unsigned.hap)，184882 字节，包名 `com.binn.hermeseye`，最低/目标 API 均为 24。SHA-256：`0959FF37953129FB14DC505DA1E3BEDD9A7FCE57E5AC62458FB9CCFA9C84AFDD`。签名仍未配置；release 模式并不表示已经正式发行。

## 试用步骤（签名与安装后）
1. 设置页填写自己的服务地址与模型、Token，检测连接；正式连接使用 HTTPS。局域网 HTTP 仅用于主动开启的内网 IP 调试。
2. 数据页添加记录，按需读取设备与今日日历。
3. 对话页选择本次分享内容，检查预览后发送；历史中已发送快照会继续参与后续会话。
4. 任务页填写名称与 HH:mm、每天或工作日；授权通知后注册系统提醒。
5. 关闭应用/锁屏进行提醒验证，再验证取消。该功能不会自动调用 Hermes。

## 正式发布阻塞项
真实 Hermes 协议确认与端到端联调；用户设备系统版本与 API 24 兼容性；手机调试/发行签名；日历权限、通知授权、后台提醒及 UI 视觉验收；服务端周期执行与结果同步尚未实现。不能把当前 unsigned 包称为可直接安装的正式发布版。

## 首版已知限制
仅文本对话、单会话、非流式等待，超时 60 秒后服务端可能仍执行；无自动重试。Token 重启需重填。个人记录仅新增/删除；无搜索、编辑和导出。系统快照只在前台主动读取；不提供远程任意后台拉取。明文文件位于系统应用沙箱，尚无应用层数据加密。提醒与本地记录跨系统不具备事务，创建保存失败时尝试取消补偿，进程在两步间退出可能需要对账。尚未做大字体/窄屏/平板/性能验收。

## V0.2 工作区变更 · 2026-09-25

上文为 v0.1.0 归档报告和旧包操作路径，不代表 V0.2 的发布验收。`releases/v0.1.0/` 历史产物保持原样，本次未生成新的正式发行归档。

### 本轮实现
- 产品定位调整为个人学习与效率提升助手；HermesEye 是 Hermes 的鸿蒙交互与感知界面。
- 四个主入口“今日 / 记录 / 助手 / 我的”；提醒、回顾、数据来源、连接调整为二级页面。
- 今日直接记一笔，记录日期分组，助手回复标明 AI 生成；回顾仅呈现真实本机计数。
- V0.2 全套深浅色语义资源、共用组件、线性导航图标、48vp 触控基线与宽屏侧栏。
- 跟随系统及本次运行内显示模式切换；停止等待保留输入并拒收迟到响应，不宣称停止服务端任务。

### 本轮验证
领域测试 11 组通过；服务测试 8 组通过（含停止等待、迟到响应、停止后重新发送和资源释放）。ArkTS/资源编译与 Debug 未签名 HAP 构建通过。构建仍有现有系统 API 异常处理静态提示；不能替代设备错误分支测试。

本轮未完成真实设备视觉验收、Hypium UI、真实 Hermes 联调、签名安装。显示模式持久化、双栏详情、记录编辑搜索、云同步及提醒完成/稍后提醒未实现，详见页面设计差异清单。

### 当前试用路径
今日记一笔 → 我的 / 助手连接配置 → 我的 / 数据来源按需读取 → 助手选择上下文并发送 → 今日 / 管理系统提醒创建下一步。回顾从今日进入。

macOS 自测使用 DevEco 自带 Node：
```sh
export DEVECO_HOME=/Applications/DevEco-Studio.app/Contents
"$DEVECO_HOME/tools/node/bin/node" scripts/test-domain.cjs
"$DEVECO_HOME/tools/node/bin/node" scripts/test-services.cjs
export DEVECO_SDK_HOME="$DEVECO_HOME/sdk"
export JAVA_HOME="$DEVECO_HOME/jbr/Contents/Home"
"$DEVECO_HOME/tools/node/bin/node" "$DEVECO_HOME/tools/hvigor/bin/hvigorw.js" --mode module -p product=default -p module=entry@default -p buildMode=debug assembleHap --no-daemon
```
