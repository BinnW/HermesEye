import { common } from '@kit.AbilityKit';
import { KeyboardAvoidMode, window } from '@kit.ArkUI';
import { platformCode, platformFailure, reportPlatformFailure } from './PlatformErrors';

// One observer per page. Ignore asynchronous window lookups/events after teardown.
export class KeyboardAvoidance {
  private generation: number = 0;
  private currentWindow?: window.Window;
  private listener?: (height: number) => void;

  async start(context: common.UIAbilityContext, changed: (visible: boolean) => void): Promise<void> {
    this.stop();
    const generation = this.generation;
    let operation = 'window.lookup';
    try {
      const mainWindow = await window.getLastWindow(context);
      if (generation !== this.generation) { return; }
      operation = 'window.keyboardMode';
      mainWindow.getUIContext().setKeyboardAvoidMode(KeyboardAvoidMode.RESIZE_WITH_CARET);
      const listener = (height: number): void => {
        if (generation === this.generation) { changed(height > 0); }
      };
      operation = 'window.keyboardOn';
      mainWindow.on('keyboardHeightChange', listener);
      this.currentWindow = mainWindow;
      this.listener = listener;
      operation = 'window.keyboardArea';
      listener(mainWindow.getWindowAvoidArea(window.AvoidAreaType.TYPE_KEYBOARD).bottomRect.height);
    } catch (error) {
      if (generation !== this.generation) { reportPlatformFailure(operation, error as Error); return; }
      try { this.stop(); } catch (cleanupError) { reportPlatformFailure('window.keyboardCleanup', cleanupError as Error); }
      const code = platformCode(error as Error);
      const advice = code === 1300002 || code === 1300006 ? '页面窗口暂不可用，请重新打开应用以恢复键盘适配' :
        '键盘适配初始化失败，请重新打开应用';
      throw platformFailure(operation, error as Error, advice);
    }
  }

  stop(): void {
    this.generation++;
    const currentWindow = this.currentWindow;
    const listener = this.listener;
    if (currentWindow && listener) {
      try { currentWindow.off('keyboardHeightChange', listener); }
      catch (error) {
        // A destroyed window has no live listener. Other failures retain the handle for a later cleanup attempt.
        if (platformCode(error as Error) !== 1300002) {
          throw platformFailure('window.keyboardOff', error as Error, '键盘监听清理失败');
        }
        reportPlatformFailure('window.keyboardOff.destroyed', error as Error);
      }
    }
    this.currentWindow = undefined;
    this.listener = undefined;
  }
}
