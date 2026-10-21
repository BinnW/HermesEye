import { describe, it, expect, beforeAll } from '@ohos/hypium';
import { Driver, ON, abilityDelegatorRegistry } from '@kit.TestKit';
import { CredentialStore } from '../../../main/ets/services/CredentialStore';
import { newId } from '../../../main/ets/core/Workspace';

// Run against an unlocked test device with its software keyboard enabled.
export default function abilityTest() {
  describe('WorkspaceV1Device', () => {
    beforeAll(async () => {
      await abilityDelegatorRegistry.getAbilityDelegator().startAbility({
        bundleName: 'com.binn.hermeseye', abilityName: 'EntryAbility'
      });
      await Driver.create().delayMs(1500);
    });
    it('fourMainDestinationsAreAccessible', 0, async () => {
      const driver = Driver.create();
      await driver.assertComponentExist(ON.id('plan-date-selector'));
      await driver.assertComponentExist(ON.id('main-navigation-0'));
      await driver.assertComponentExist(ON.id('main-navigation-1'));
      await driver.assertComponentExist(ON.id('main-navigation-2'));
      await driver.assertComponentExist(ON.id('main-navigation-3'));
    });
    it('readingShowsMissingDataInsteadOfFakeStatistics', 0, async () => {
      const driver = Driver.create();
      const reading = await driver.findComponent(ON.id('main-navigation-2'));
      await reading.click();
      await driver.delayMs(300);
      await driver.assertComponentExist(ON.id('main-navigation-2'));
      await driver.assertComponentExist(ON.text('授权采集笔记、周期整理与逐条疑问讨论，不评估理解程度。'));
      const today = await driver.findComponent(ON.id('main-navigation-0'));
      await today.click();
    });
    it('keyboardLeavesFormScrollableAndRestoresNavigationWithoutLosingInput', 0, async () => {
      const driver = Driver.create();
      await (await driver.findComponent(ON.id('main-navigation-1'))).click();
      await driver.delayMs(300);
      await (await driver.findComponent(ON.id('project-create'))).click();
      await driver.delayMs(300);
      // 表单字段位于滚动区顶部，直接按 id 定位；避免对 workspace-scroll 句柄做 scrollSearch（键盘会重建滚动容器）。
      let name = await driver.findComponent(ON.id('project-name'));
      for (let attempt = 0; attempt < 10 && !name; attempt++) {
        await driver.delayMs(200);
        name = await driver.findComponent(ON.id('project-name'));
      }
      await name.click();
      await driver.delayMs(800);
      expect((await driver.findComponent(ON.id('main-navigation-0'))) === null).assertTrue();
      await name.inputText('Keyboard regression draft');
      // 第一次 pressBack 收起软键盘；表单仍在，底部导航仍隐藏。
      await driver.pressBack();
      await driver.delayMs(500);
      expect((await driver.findComponent(ON.id('main-navigation-0'))) === null).assertTrue();
      let retained = await driver.findComponent(ON.id('project-name'));
      for (let attempt = 0; attempt < 10 && !retained; attempt++) {
        await driver.delayMs(200);
        retained = await driver.findComponent(ON.id('project-name'));
      }
      expect(await retained.getText()).assertEqual('Keyboard regression draft');
      // 第二次 pressBack 退出表单，回到项目列表，底部导航恢复。
      await driver.pressBack();
      await driver.delayMs(500);
      await driver.assertComponentExist(ON.id('main-navigation-0'));
      await driver.assertComponentExist(ON.id('project-search'));
      // 收尾回到今日页，确保后续用例处于确定状态。
      await (await driver.findComponent(ON.id('main-navigation-0'))).click();
      await driver.delayMs(300);
    });
    it('businessPreviewIsReachableWithoutChangingLegacyWorkspace', 0, async () => {
      const driver = Driver.create();
      await abilityDelegatorRegistry.getAbilityDelegator().startAbility({ bundleName: 'com.binn.hermeseye', abilityName: 'EntryAbility' });
      await driver.delayMs(500);
      await (await driver.findComponent(ON.id('main-navigation-3'))).click();
      await driver.delayMs(300);
      await (await driver.findComponent(ON.id('profile-agent'))).click();
      await driver.delayMs(300);
      const scroll = await driver.findComponent(ON.id('workspace-scroll'));
      await (await scroll.scrollSearch(ON.text('独立业务服务（本地预览）'))).click();
      await driver.delayMs(300);
      await driver.assertComponentExist(ON.text('业务服务 · 本地预览'));
      await driver.assertComponentExist(ON.text('连接独立业务服务'));
      await driver.pressBack();
      await driver.delayMs(300);
      await driver.pressBack();
      for (let attempt = 0; attempt < 10; attempt++) {
        if (await driver.findComponent(ON.id('main-navigation-3'))) { break; }
        await driver.delayMs(200);
      }
      await driver.assertComponentExist(ON.id('main-navigation-3'));
      await (await driver.findComponent(ON.id('main-navigation-0'))).click();
    });
    it('missingSecureCredentialFailsExplicitlyAndRemovalIsIdempotent', 0, async () => {
      const store = new CredentialStore();
      const alias = 'hermes-eye-absent-test-' + newId();
      await store.remove(alias);
      let failed = false;
      try { await store.read(alias); }
      catch (error) {
        failed = true;
        expect((error as Error).message.includes('asset.query')).assertTrue();
        expect((error as Error).message.includes(alias)).assertFalse();
      }
      expect(failed).assertTrue();
      await store.remove(alias);
    });
    it('systemAssetPersistsAcrossStoreInstances', 0, async () => {
      const first = new CredentialStore(); const token = 'test-only-' + newId();
      const alias = await first.save(token);
      try { expect(await new CredentialStore().read(alias)).assertEqual(token); }
      finally { await first.remove(alias); }
    });
  });
}
