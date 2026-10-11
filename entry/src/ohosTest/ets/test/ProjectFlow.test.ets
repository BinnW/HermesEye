import { describe, it, expect, beforeAll } from '@ohos/hypium';
import { Driver, ON, abilityDelegatorRegistry } from '@kit.TestKit';

// 项目模块的设备端模拟点击用例（PRJ-01/02/12）。
// 设计约束：只做只读交互（检索、筛选、打开表单、返回），不创建也不修改项目，
// 因此可以在同一台设备上重复执行、不会污染其他用例依赖的数据。
//
// 为什么不在设备层跑完整的"新建→里程碑→复盘→归档"：模拟器上表单中段字段会被软键盘遮挡，
// TestKit 的 scrollSearch 在这些字段上会长时间阻塞（实测两次 60 秒超时并连带影响后续用例）。
// 该业务链路已由 Node 层 F08（真实 ProjectPanel/Workspace 规则 + 130+ 断言）确定性覆盖，
// 设备层只验证入口可达、字段渲染与"返回不落盘"这一层 UI 装配。
export default function projectFlowTest() {
  describe('HermesEyeProjectFlows', () => {
    beforeAll(async () => {
      await abilityDelegatorRegistry.getAbilityDelegator().startAbility({
        bundleName: 'com.binn.hermeseye', abilityName: 'EntryAbility'
      });
      await Driver.create().delayMs(1500);
    });

    it('projectListSearchAndStatusFiltersStayConsistent', 0, async () => {
      const driver = Driver.create();
      await (await driver.findComponent(ON.id('main-navigation-1'))).click();
      await driver.delayMs(500);
      const cacheDir = abilityDelegatorRegistry.getAbilityDelegator().getAppContext().cacheDir;
      expect(await driver.screenCap(cacheDir + '/hermes-v2-projects.png')).assertTrue();
      await driver.assertComponentExist(ON.id('project-search'));
      await driver.assertComponentExist(ON.id('project-state-filter'));
      const search = await (await driver.findComponent(ON.id('workspace-scroll'))).scrollSearch(ON.id('project-search'));
      await search.click();
      await driver.delayMs(300);
      await search.inputText('zzz-不存在的项目-zzz');
      await driver.delayMs(600);
      // 无匹配必须给出明确空态，而不是让人以为数据丢失。
      await driver.assertComponentExist(ON.id('project-empty-filter'));
      await (await driver.findComponent(ON.id('project-search'))).clearText();
      await driver.delayMs(500);
      await driver.pressBack();
      await driver.delayMs(300);
      await (await driver.findComponent(ON.id('project-state-filter'))).click();
      await driver.delayMs(400);
      await driver.assertComponentExist(ON.id('project-filter-archived'));
      await (await driver.findComponent(ON.id('project-filter-archived'))).click();
      await driver.delayMs(800);
      expect((await driver.findComponent(ON.id('project-filter-active'))) === null).assertTrue();
      await (await driver.findComponent(ON.id('project-state-filter'))).click();
      await driver.delayMs(400);
      await (await driver.findComponent(ON.id('project-filter-active'))).click();
      await driver.delayMs(400);
    });

    it('projectNewFormOpensKeepsListAndDiscardsOnBack', 0, async () => {
      const driver = Driver.create();
      const scroll = await driver.findComponent(ON.id('workspace-scroll'));
      await (await scroll.scrollSearch(ON.id('project-create'))).click();
      await driver.delayMs(700);
      // 必填字段与类型选择必须真实渲染（PRJ-02）。
      await driver.assertComponentExist(ON.id('project-name'));
      await driver.assertComponentExist(ON.id('project-kind'));
      expect((await driver.findComponent(ON.id('main-navigation-1'))) === null).assertTrue();
      // 返回不保存：表单关闭后仍回到项目列表，输入控件不再存在（进程内草稿允许保留，见 PRJ-12）。
      await driver.pressBack();
      await driver.delayMs(600);
      await driver.assertComponentExist(ON.id('project-search'));
      expect((await driver.findComponent(ON.id('project-name'))) === null).assertTrue();
      await (await driver.findComponent(ON.id('main-navigation-1'))).click();
      await driver.delayMs(300);
      await driver.assertComponentExist(ON.id('project-state-filter'));
    });
  });
}
