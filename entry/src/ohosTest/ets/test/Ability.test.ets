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
      await driver.assertComponentExist(ON.text('HermesEye'));
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
      await (await (await driver.findComponent(ON.id('workspace-scroll'))).scrollSearch(ON.id('project-create'))).click();
      await driver.delayMs(300);
      const scroll = await driver.findComponent(ON.id('workspace-scroll'));
      const before = await scroll.getBounds();
      const name = await scroll.scrollSearch(ON.id('project-name'));
      await name.click();
      await driver.delayMs(800);
      expect((await driver.findComponent(ON.id('main-navigation-0'))) === null).assertTrue();
      const reduced = await (await driver.findComponent(ON.id('workspace-scroll'))).getBounds();
      expect(reduced.bottom < before.bottom).assertTrue();
      await name.inputText('Keyboard regression draft');
      const goal = await (await driver.findComponent(ON.id('workspace-scroll')))
        .scrollSearch(ON.id('project-goal'));
      await goal.click();
      await goal.inputText('First line\nSecond line\nThird line\nFourth line\nFifth line\nSixth line');
      const submit = await (await driver.findComponent(ON.id('workspace-scroll'))).scrollSearch(ON.id('project-save'));
      const buttonBounds = await submit.getBounds();
      const viewport = await (await driver.findComponent(ON.id('workspace-scroll'))).getBounds();
      expect(buttonBounds.top >= viewport.top && buttonBounds.bottom <= viewport.bottom).assertTrue();
      expect((await driver.findComponent(ON.id('main-navigation-0'))) === null).assertTrue();
      await driver.pressBack();
      await driver.delayMs(500);
      expect((await driver.findComponent(ON.id('main-navigation-0'))) === null).assertTrue();
      const restored = await (await driver.findComponent(ON.id('workspace-scroll'))).getBounds();
      expect(restored.bottom).assertEqual(before.bottom);
      const retained = await (await driver.findComponent(ON.id('workspace-scroll'))).scrollSearch(ON.id('project-name'));
      expect(await retained.getText()).assertEqual('Keyboard regression draft');
      // Leave the form without creating a project or calling Hermes.
      await (await (await driver.findComponent(ON.id('workspace-scroll'))).scrollSearch(ON.text('返回'))).click();
      await driver.delayMs(500);
      await (await driver.findComponent(ON.id('main-navigation-0'))).click();
    });
    it('businessPreviewIsReachableWithoutChangingLegacyWorkspace', 0, async () => {
      const driver = Driver.create();
      await abilityDelegatorRegistry.getAbilityDelegator().startAbility({ bundleName: 'com.binn.hermeseye', abilityName: 'EntryAbility' });
      await driver.delayMs(500);
      await (await driver.findComponent(ON.id('main-navigation-3'))).click();
      const scroll = await driver.findComponent(ON.id('workspace-scroll'));
      await (await scroll.scrollSearch(ON.text('独立业务服务（本地预览）'))).click();
      await driver.delayMs(300);
      await driver.assertComponentExist(ON.text('业务服务 · 本地预览'));
      await driver.assertComponentExist(ON.text('连接独立业务服务'));
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
