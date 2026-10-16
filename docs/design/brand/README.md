# HermesEye 应用图标

设计日期：2026-10-11。图标服务于 Hermes 的个人学习与效率助手定位，采用“眼睛＋负形 H”：外轮廓表达感知与理解，中心 H 表达 Hermes；不代表摄像头采集或新增权限。

## 视觉与尺寸

- 葱青 `#34785A` 底色、米白 `#F5F2EA` 标记，沿用07视觉规范；固定品牌配色，不随页面主题变换。
- 无文字、阴影、发光或细碎装饰；36/1024轮廓，主体位于中央约62%宽度，预留系统圆形/圆角裁切空间。
- 启动与预览采用圆角背景；桌面分层背景保持满幅，由系统裁切外形。
- 已检查32、48、64、128像素预览，实际系统缩放与不同桌面蒙版仍以设备为准。

## 源稿与资源

[可编辑SVG](hermeseye-icon.svg)为源稿，[512px预览](hermeseye-icon.png)供评审。通过 `render-icon.cjs` 使用Sharp 0.35.5导出PNG，无AI生成位图依赖。准备可用的Sharp后，从任意目录运行：

```bash
node docs/design/brand/render-icon.cjs
# Sharp安装在其他目录时，通过NODE_PATH指向相应node_modules。
```

|资源|用途|
|---|---|
|AppScope与entry的 `hermes_background.png`|1024×1024不透明背景|
|AppScope与entry的 `hermes_foreground.png`|1024×1024透明前景，H为透明负形|
|entry的 `hermes_start.png`|256×256透明圆角启动图|
|两处 `layered_image.json`|统一引用相同前景/背景；app.json5与module.json5保留分层入口|

更新源稿后重新导出，再运行 `bash scripts/verify.sh --deny-arkts-warnings --label app-icon`。编译通过不代表所有桌面裁切已验收，本次15/15构建门禁通过、API26模拟器安装与启动成功；实际结果记录于05。设计稿可提交；验证日志仍仅保留本地。
