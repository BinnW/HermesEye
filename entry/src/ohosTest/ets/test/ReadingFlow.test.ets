import { describe, it, expect, beforeAll } from '@ohos/hypium';
import { Driver, ON, abilityDelegatorRegistry } from '@kit.TestKit';

// 只读设备回归：验证 V1 入口与未连接状态，不对真实书籍发起外部采集。
export default function readingFlowTest() {
  describe('HermesEyeReadingFlows', () => {
    beforeAll(async () => {
      await abilityDelegatorRegistry.getAbilityDelegator().startAbility({
        bundleName: 'com.binn.hermeseye', abilityName: 'EntryAbility'
      });
      await Driver.create().delayMs(1200);
    });
    it('readingV1ShowsExplicitBusinessConnectionAndNoAutomaticCollection', 0, async () => {
      const driver = Driver.create();
      await (await driver.findComponent(ON.id('main-navigation-2'))).click();
      await driver.delayMs(400);
      const scroll = await driver.findComponent(ON.id('workspace-scroll'));
      await scroll.scrollSearch(ON.id('reading-root'));
      await driver.assertComponentExist(ON.id('reading-root'));
      await driver.assertComponentExist(ON.id('reading-token'));
      await scroll.scrollSearch(ON.id('reading-connect'));
      await driver.assertComponentExist(ON.id('reading-connect'));
      // 周期设置必须在连接后显示；浏览入口不会自动调用采集/整理接口。
      expect((await driver.findComponent(ON.id('reading-collect'))) === null).assertTrue();
      await (await driver.findComponent(ON.id('main-navigation-0'))).click();
      await driver.delayMs(300);
      await driver.assertComponentExist(ON.id('main-navigation-2'));
    });

    it('readingEntryFromHomeKeepsPolicyControlsHiddenWhileUnconnected', 0, async () => {
      const driver = Driver.create();
      // 从首页「阅读概览」进入阅读页，验证入口与 tab 状态一致。
      await (await driver.findComponent(ON.id('main-navigation-0'))).click();
      await driver.delayMs(400);
      const scroll = await driver.findComponent(ON.id('workspace-scroll'));
      // TestKit's edge swipe starts beneath the floating capsule; swipe in the
      // visible content instead, as a user does, and stop once the entry is safe.
      const bounds = await scroll.getBounds();
      const nav = await (await driver.findComponent(ON.id('main-navigation-0'))).getBounds();
      for (let attempt = 0; attempt < 8; attempt++) {
        const entry = await driver.findComponent(ON.id('home-reading'));
        if (entry && (await entry.getBounds()).bottom < nav.top - 24) { break; }
        const height = bounds.bottom - bounds.top;
        await driver.swipe(Math.round((bounds.left + bounds.right) / 2), Math.round(bounds.top + height * 0.6),
          Math.round((bounds.left + bounds.right) / 2), Math.round(bounds.top + height * 0.2));
        await driver.delayMs(300);
      }
      const cacheDir = abilityDelegatorRegistry.getAbilityDelegator().getAppContext().cacheDir;
      expect(await driver.screenCap(cacheDir + '/hermes-v2-home-bottom.png')).assertTrue();
      await (await driver.findComponent(ON.id('home-reading'))).click();
      await driver.delayMs(500);
      await driver.assertComponentExist(ON.id('main-navigation-2'));
      await (await driver.findComponent(ON.id('workspace-scroll'))).scrollSearch(ON.id('reading-root'));
      await driver.assertComponentExist(ON.id('reading-root'));
      await driver.assertComponentExist(ON.id('reading-connect'));
      // 未连接时不得出现周期设置、采集或提问入口，也不得伪造任何进度数字。
      for (const hidden of ['reading-consent', 'reading-enabled', 'reading-save-policy', 'reading-collect', 'reading-ask']) {
        expect((await driver.findComponent(ON.id(hidden))) === null).assertTrue();
      }
      await (await driver.findComponent(ON.id('main-navigation-0'))).click();
      await driver.delayMs(300);
      await driver.assertComponentExist(ON.id('main-navigation-0'));
    });
  });
}
