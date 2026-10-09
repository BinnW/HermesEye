import { hilog } from '@kit.PerformanceAnalysisKit';
import { BackupExtensionAbility, BundleVersion } from '@kit.CoreFileKit';
import { LOG_DOMAIN, LogTag } from '../services/Logging';

export default class EntryBackupAbility extends BackupExtensionAbility {
  async onBackup() {
    hilog.info(LOG_DOMAIN, LogTag.Backup, '备份回调完成');
    await Promise.resolve();
  }

  async onRestore(bundleVersion: BundleVersion) {
    // 只记录版本号：bundleVersion 的其余字段对排查无价值，且备份内容不应入日志。
    hilog.info(LOG_DOMAIN, LogTag.Backup, '恢复回调完成，备份版本=%{public}d', bundleVersion.code);
    await Promise.resolve();
  }
}
