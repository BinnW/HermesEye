import { common } from '@kit.AbilityKit';
import { KeyboardAvoidMode, window } from '@kit.ArkUI';

// One observer per page. Ignore asynchronous window lookups/events after teardown.
export class KeyboardAvoidance {
  private generation: number = 0;
  private currentWindow?: window.Window;
  private listener?: (height: number) => void;

  async start(context: common.UIAbilityContext, changed: (visible: boolean) => void): Promise<void> {
    this.stop();
    const generation = this.generation;
    const mainWindow = await window.getLastWindow(context);
    if (generation !== this.generation) { return; }
    mainWindow.getUIContext().setKeyboardAvoidMode(KeyboardAvoidMode.RESIZE_WITH_CARET);
    const listener = (height: number): void => {
      if (generation === this.generation) { changed(height > 0); }
    };
    mainWindow.on('keyboardHeightChange', listener);
    this.currentWindow = mainWindow;
    this.listener = listener;
    listener(mainWindow.getWindowAvoidArea(window.AvoidAreaType.TYPE_KEYBOARD).bottomRect.height);
  }

  stop(): void {
    this.generation++;
    const currentWindow = this.currentWindow;
    const listener = this.listener;
    this.currentWindow = undefined;
    this.listener = undefined;
    if (currentWindow && listener) { currentWindow.off('keyboardHeightChange', listener); }
  }
}
