import { common, ConfigurationConstant } from '@kit.AbilityKit';
import { UIContext } from '@kit.ArkUI';
import { platformCode, platformFailure, reportPlatformFailure } from './PlatformErrors';

export function showToast(context: UIContext, message: string, failed: boolean): boolean {
  try {
    context.getPromptAction().showToast({ message: message, duration: failed ? 5000 : 3000 });
    return true;
  } catch (error) {
    // Presentation failure must not roll back or misreport a completed business operation.
    const operation = platformCode(error as Error) === 100001 ? 'toast.unavailable' : 'toast.show';
    reportPlatformFailure(operation, error as Error);
    return false;
  }
}

export function applySystemAppearance(context: common.UIAbilityContext, index: number): void {
  const modes: ConfigurationConstant.ColorMode[] = [ConfigurationConstant.ColorMode.COLOR_MODE_NOT_SET,
    ConfigurationConstant.ColorMode.COLOR_MODE_LIGHT, ConfigurationConstant.ColorMode.COLOR_MODE_DARK];
  if (!Number.isInteger(index) || index < 0 || index >= modes.length) { throw new Error('无效的显示模式'); }
  try { context.getApplicationContext().setColorMode(modes[index]); }
  catch (error) {
    const advice = platformCode(error as Error) === 16000011 ? '应用上下文已失效，请重新打开应用以应用显示模式' :
      '显示模式切换失败，请重新打开应用';
    throw platformFailure('appearance.setColorMode', error as Error, advice);
  }
}
