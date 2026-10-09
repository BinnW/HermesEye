import { AbilityConstant, ConfigurationConstant, UIAbility, Want } from '@kit.AbilityKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { window } from '@kit.ArkUI';
import { LOG_DOMAIN, LogTag } from '../services/Logging';
import { platformCode } from '../services/PlatformErrors';

export default class EntryAbility extends UIAbility {
  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    try {
      this.context.getApplicationContext().setColorMode(ConfigurationConstant.ColorMode.COLOR_MODE_NOT_SET);
    } catch (error) {
      // 只记录错误码：颜色模式设置失败不影响启动，原始错误对象可能带路径信息。
      hilog.error(LOG_DOMAIN, LogTag.Ability, '设置颜色模式失败，错误码=%{public}d', platformCode(error as Error));
    }
    hilog.info(LOG_DOMAIN, LogTag.Ability, 'Ability 创建');
  }

  onDestroy(): void {
    hilog.info(LOG_DOMAIN, LogTag.Ability, 'Ability 销毁');
  }

  onWindowStageCreate(windowStage: window.WindowStage): void {
    // Main window is created, set main page for this ability
    hilog.info(LOG_DOMAIN, LogTag.Ability, '窗口阶段创建');

    windowStage.loadContent('pages/Index', (err) => {
      if (err.code) {
        hilog.error(LOG_DOMAIN, LogTag.Ability, '加载首页失败，错误码=%{public}d', err.code);
        return;
      }
      hilog.info(LOG_DOMAIN, LogTag.Ability, '首页加载完成');
    });
  }

  onWindowStageDestroy(): void {
    // Main window is destroyed, release UI related resources
    hilog.info(LOG_DOMAIN, LogTag.Ability, '窗口阶段销毁');
  }

  onForeground(): void {
    // Ability has brought to foreground
    hilog.info(LOG_DOMAIN, LogTag.Ability, '应用进入前台');
  }

  onBackground(): void {
    // Ability has back to background
    hilog.info(LOG_DOMAIN, LogTag.Ability, '应用进入后台');
  }
}
