import { describe, it, expect, beforeAll } from '@ohos/hypium';
import { Driver, ON, abilityDelegatorRegistry } from '@kit.TestKit';

// V2 readonly acceptance: the date/tool sheet and editor preserve the current date.
export default function flowTest() {
  describe('HermesEyeV2PlanFlows', () => {
    beforeAll(async () => {
      await abilityDelegatorRegistry.getAbilityDelegator().startAbility({ bundleName: 'com.binn.hermeseye', abilityName: 'EntryAbility' });
      await Driver.create().delayMs(1500);
    });
    it('planDateSheetChangesTheVisibleDateAndNewItemDate', 0, async () => {
      const driver = Driver.create();
      await (await driver.findComponent(ON.id('main-navigation-0'))).click();
      await driver.delayMs(500);
      const selector = await driver.findComponent(ON.id('plan-date-selector'));
      const today = (await selector.getText()).slice(0, 10);
      expect(today.length).assertEqual(10);
      await selector.click(); await driver.delayMs(500);
      await (await driver.findComponent(ON.text('后一天'))).click();
      await (await driver.findComponent(ON.text('关闭 · 保留当前草稿'))).click();
      await driver.delayMs(500);
      const shiftedLabel = await (await driver.findComponent(ON.id('plan-date-selector'))).getText();
      expect(shiftedLabel.slice(0, 10) === today).assertFalse();
      await (await driver.findComponent(ON.text('添加事项'))).click(); await driver.delayMs(500);
      expect(await (await driver.findComponent(ON.id('input-计划日期 YYYY-MM-DD'))).getText()).assertEqual(shiftedLabel.slice(0, 10));
      expect((await driver.findComponent(ON.id('main-navigation-0'))) === null).assertTrue();
      await driver.pressBack(); await driver.delayMs(400);
      await (await driver.findComponent(ON.id('plan-date-selector'))).click(); await driver.delayMs(400);
      await (await driver.findComponent(ON.text('今天'))).click();
      await (await driver.findComponent(ON.text('关闭 · 保留当前草稿'))).click(); await driver.delayMs(400);
      expect((await (await driver.findComponent(ON.id('plan-date-selector'))).getText()).slice(0, 10)).assertEqual(today);
    });
    it('planToolsUseOneModalAndEditorBackReturnsToSource', 0, async () => {
      const driver = Driver.create();
      await (await driver.findComponent(ON.id('plan-tools'))).click(); await driver.delayMs(400);
      await (await driver.findComponent(ON.text('手机日历'))).click(); await driver.delayMs(400);
      await driver.assertComponentExist(ON.text('日历安排 · 手机日历'));
      await driver.pressBack(); await driver.delayMs(400);
      await driver.assertComponentExist(ON.id('plan-date-selector'));
      await (await driver.findComponent(ON.text('添加事项'))).click(); await driver.delayMs(400);
      await driver.assertComponentExist(ON.id('input-计划事项（1–200 字）'));
      await driver.pressBack(); await driver.delayMs(400);
      await driver.assertComponentExist(ON.id('plan-date-selector'));
      await driver.assertComponentExist(ON.id('main-navigation-0'));
    });
  });
}
