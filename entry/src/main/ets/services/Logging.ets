/**
 * 全应用日志常量注册表（日志打印规范见 docs/16-logging-standard.md）。
 *
 * 约束：
 * 1. domain 只有一个：LOG_DOMAIN。禁止再出现 0x0000、testTag 这类 DevEco 模板默认值，
 *    否则 hilog -D/-T 无法把本应用与其他模板工程区分开。
 * 2. tag 只能取 LogTag 中的成员，且必须在本类与 docs/16 的注册表中同时登记。
 * 3. 本文件不调用 hilog，保持“常量层”无副作用；调用点自己 import hilog。
 * 4. core/ 不打印日志：core 是可移植纯规则，日志一律在 services/ 或页面事件处理里产生。
 */
export const LOG_DOMAIN: number = 0x1200;

/** 模块 tag 注册表；新增成员必须同步 docs/16-logging-standard.md。 */
export class LogTag {
  static readonly Ability: string = 'Ability';
  static readonly Backup: string = 'Backup';
  static readonly Workspace: string = 'Workspace';
  static readonly Connection: string = 'Connection';
  static readonly Credential: string = 'Credential';
  static readonly Chat: string = 'Chat';
  static readonly Calendar: string = 'Calendar';
  static readonly Reminder: string = 'Reminder';
  static readonly Keyboard: string = 'Keyboard';
  static readonly Presentation: string = 'Presentation';
  static readonly Business: string = 'Business';
  static readonly Platform: string = 'Platform';
  static readonly UI: string = 'UI';
}
