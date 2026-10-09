import { describe, it, expect, beforeAll } from '@ohos/hypium';
import { Driver, ON, abilityDelegatorRegistry } from '@kit.TestKit';

// 模拟点击的设备端业务流程用例。
// 设计约束：只做只读交互（日期切换、打开/退出编辑器），不写任何业务数据，
// 因此可以在同一台设备上重复执行，也不会污染其他用例依赖的空态。
// 需要前台已解锁、软件键盘可用的测试设备，与 Ability.test.ets 的前置条件一致。
//
// 说明：计划列表页“查看日期”输入框在点击前一天/后一天后不刷新（见 docs/10 问题11），
// 因此这里不直接断言该输入框的新值，而是通过**新建的计划编辑页**读取 planDate 状态，
// 断言点击确实改变了业务状态；列表页显示不一致单独作为问题记录，修复后再补显示断言。
export default function flowTest() {
  describe('HermesEyeClickFlows', () => {
    beforeAll(async () => {
      await abilityDelegatorRegistry.getAbilityDelegator().startAbility({
        bundleName: 'com.binn.hermeseye', abilityName: 'EntryAbility'
      });
      await Driver.create().delayMs(1500);
    });

    it('planDateButtonsChangeTheDateUsedByThePlanEditor', 0, async () => {
      const driver = Driver.create();
      await (await driver.findComponent(ON.id('main-navigation-0'))).click();
      await driver.delayMs(300);
      const scroll = await driver.findComponent(ON.id('workspace-scroll'));
      await (await scroll.scrollSearch(ON.text('制定与查看每日计划'))).click();
      await driver.delayMs(600);
      const today = await (await driver.findComponent(ON.id('input-查看日期 YYYY-MM-DD'))).getText();
      expect(today.length).assertEqual(10);
      await (await driver.findComponent(ON.text('后一天'))).click();
      await driver.delayMs(600);
      await (await driver.findComponent(ON.text('添加计划'))).click();
      await driver.delayMs(700);
      const shifted = await (await driver.findComponent(ON.id('input-计划日期 YYYY-MM-DD'))).getText();
      expect(shifted === today).assertFalse();
      await driver.pressBack();
      await driver.delayMs(500);
      await (await driver.findComponent(ON.text('今天'))).click();
      await driver.delayMs(500);
      await (await driver.findComponent(ON.text('添加计划'))).click();
      await driver.delayMs(700);
      const restored = await (await driver.findComponent(ON.id('input-计划日期 YYYY-MM-DD'))).getText();
      expect(restored).assertEqual(today);
      await driver.pressBack();
      await driver.delayMs(500);
    });

    it('planEditorOpensAndBackKeepsThePlanListWithoutSaving', 0, async () => {
      const driver = Driver.create();
      await (await driver.findComponent(ON.text('添加计划'))).click();
      await driver.delayMs(700);
      await driver.assertComponentExist(ON.id('input-计划日期 YYYY-MM-DD'));
      await driver.assertComponentExist(ON.id('input-计划事项（1–200 字）'));
      // 返回两次：第一次离开编辑器回到计划页，第二次回到今日页，全程不保存。
      await driver.pressBack();
      await driver.delayMs(500);
      await driver.assertComponentExist(ON.text('每日计划'));
      await driver.assertComponentExist(ON.text('添加计划'));
      await driver.pressBack();
      await driver.delayMs(500);
      await driver.assertComponentExist(ON.id('main-navigation-0'));
      await driver.assertComponentExist(ON.id('main-navigation-3'));
    });
  });
}
