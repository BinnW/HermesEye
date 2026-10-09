// Interactive flow tests: simulate the user's click sequences on Index.ets and assert the
// resulting page state, persisted snapshot and Chinese feedback.
//
// Index.ets cannot be imported directly (ArkUI decorators + @kit imports), so each case
// slices only the production method bodies it clicks through, transpiles them into one
// plain class, and runs that class in a VM with mocked platform abilities. The domain
// rules come from the real core/Workspace.ts and core/Domain.ts; the connection save path
// also uses the real services/ConnectionService.ets. Nothing here is device acceptance.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { loadTypescript } = require('./lib/deveco-env.cjs');
const ts = loadTypescript();
const platformLogs = [];
function load(relative, imports = {}) {
  if (relative !== 'services/PlatformErrors.ets' && relative !== 'services/Logging.ets') {
    imports = { './PlatformErrors': load('services/PlatformErrors.ets', {
      '@kit.PerformanceAnalysisKit': { hilog: { error: (...args) => platformLogs.push(args) } },
      './Logging': load('services/Logging.ets')
    }), ...imports };
  }
  const source = fs.readFileSync(path.join(__dirname, '../entry/src/main/ets', relative), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2021, module: ts.ModuleKind.CommonJS } });
  const sandbox = { exports: {}, require(name) { if (!(name in imports)) throw Error('Unexpected import ' + name); return imports[name]; } };
  vm.runInNewContext(output.outputText, sandbox, { filename: path.join(__dirname, '../entry/src/main/ets', relative) });
  return sandbox.exports;
}
const domain = load('core/Domain.ts');
const w = load('core/Workspace.ts', { './Domain': domain });
const presentation = load('services/SystemPresentation.ets', { '@kit.AbilityKit': { ConfigurationConstant: {} } });
const ConnectionService = load('services/ConnectionService.ets', { '../core/Workspace': w }).ConnectionService;
const pagePath = path.join(__dirname, '../entry/src/main/ets/pages/Index.ets');
const pageSource = fs.readFileSync(pagePath, 'utf8');

// Named method ranges inside entry/src/main/ets/pages/Index.ets. Markers must stay unique.
const GROUPS = {
  nav: { from: '  private space(): Space', to: '  private applyAppearance(' },
  forms: { from: '  private rememberForms(): void', to: '  private async commit(' },
  commit: { from: '  private async commit(', to: '  private config(): Connection' },
  plan: { from: '  private async addPlan(', to: '  private async saveRecord(' },
  connection: { from: '  private config(): Connection', to: '  private async addProject(' },
  fill: { from: '  private fillConnection(): void', to: '  private async load(' },
  calendar: { from: '  private async refreshCalendar(', to: '  private async addReminder(' },
  send: { from: '  private async send()', to: '  private async refreshCalendar(' }
};

function slice(from, to) {
  const start = pageSource.indexOf(from);
  const end = pageSource.indexOf(to);
  if (start < 0 || end <= start) { throw new Error(`Index.ets 切片失败：${from} -> ${to}`); }
  return pageSource.slice(start, end);
}

function makePage(name, groups, globals) {
  const body = groups.map((key) => slice(GROUPS[key].from, GROUPS[key].to)).join('\n');
  const source = `class ${name} {\n${body}\n}\nexports.${name} = ${name};`;
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2021, module: ts.ModuleKind.CommonJS } }).outputText;
  const sandbox = { exports: {}, setTimeout, clearTimeout, ...globals };
  vm.runInNewContext(compiled, sandbox, { filename: pagePath });
  return sandbox.exports[name];
}

const PAGE_GLOBALS = {
  activeSpace: w.activeSpace, copyWorkspace: w.copyWorkspace, serverKey: w.serverKey, connectionUrl: w.connectionUrl,
  dayKey: w.dayKey, validDate: w.validDate, importCalendarPlans: w.importCalendarPlans, savePlan: w.savePlan,
  removePlan: w.removePlan, shiftDay: w.shiftDay, planCounts: w.planCounts, dailyReport: w.dailyReport,
  cleanText: domain.cleanText, createRequest: domain.createRequest, newId: w.newId,
  showToast: presentation.showToast, applySystemAppearance: () => {}, ConnectionService: ConnectionService
};

// Builds a page stand-in with every @State/private field the sliced methods touch and the
// usual platform mocks. `saved` records each repository.save argument, `toasts` each notice.
function openPage(name, groups, globals = {}) {
  const Harness = makePage(name, groups, { ...PAGE_GLOBALS, ...globals });
  const h = new Harness();
  const toasts = [];
  const saved = [];
  h.data = w.newWorkspace();
  h.ready = true; h.loaded = true; h.busy = false; h.sending = false;
  h.tab = 0; h.route = ''; h.history = []; h.chatDraft = '';
  h.drafts = new Map(); h.offsets = new Map(); h.formDrafts = new Map(); h.projectDrafts = new Map();
  h.shareCalendar = false; h.shareDevice = false; h.shareNeed = '';
  h.projectName = ''; h.projectGoal = ''; h.managedBy = 'manual';
  h.needName = ''; h.needDescription = ''; h.needProject = '';
  h.rename = ''; h.moveProject = '';
  h.planTitle = ''; h.planDate = w.dayKey(new Date()); h.planProject = '';
  h.planEditId = ''; h.planEditDate = h.planDate; h.planPriority = 'normal'; h.planMinutes = ''; h.planNote = '';
  h.planFilter = 'all'; h.confirmPlanDelete = false;
  h.calendarEntries = []; h.calendarSelection = []; h.calendarDate = ''; h.calendarError = '';
  h.recordText = ''; h.recordUnfinished = ''; h.recordEnergy = ''; h.recordDecision = ''; h.recordTodo = '';
  h.recordStart = ''; h.recordEnd = ''; h.backfilled = false;
  h.reportDate = h.planDate; h.reminderTitle = ''; h.reminderTime = '21:00'; h.weekdays = false;
  h.projectNextStep = '';
  h.connectionStatus = '尚未连接';
  h.name = ''; h.host = ''; h.protocol = 'https'; h.port = '443'; h.basePath = ''; h.model = 'hermes-agent';
  h.token = ''; h.showToken = false; h.allowHttp = false; h.autoConnect = false;
  h.pendingPrompt = ''; h.pendingKey = ''; h.sendError = ''; h.pendingScrolled = false;
  h.lastToast = ''; h.lastToastAt = 0;
  h.snapshot = { calendar: '', device: '', capturedAt: 0 };
  h.getUIContext = () => ({ getPromptAction: () => ({ showToast: (options) => toasts.push(options) }) });
  h.context = () => ({ filesDir: '/sandbox' });
  h.scroller = { currentOffset: () => ({ yOffset: 0 }), scrollTo() {} };
  h.repository = { save: async (value) => { saved.push(value); } };
  h.credentials = { read: async () => 'test-token', save: async () => 'unused-ref', remove: async () => {} };
  h.client = { check: async () => {}, chat: async () => 'answer', stop() {} };
  h.selectedProject = () => undefined;
  h.selectedNeed = () => undefined;
  h.sharePreview = () => '';
  return { h, toasts, saved };
}

function project(id, name) { return { id: id, name: name, goal: '完成目标', managedBy: 'manual', nextStep: '' }; }
function plan(id, date, title, status, extra = {}) {
  return { id: id, date: date, title: title, status: status, projectId: '', ...extra };
}
function connection(host = 'example.org') {
  return { name: 'Home', host: host, protocol: 'https', port: 443, basePath: '', model: 'hermes-agent',
    allowPrivateHttp: false, autoConnect: false, credentialRef: '' };
}
function lastToast(toasts) { return toasts.length ? toasts[toasts.length - 1].message : ''; }
function tick() { return new Promise((resolve) => setImmediate(resolve)); }
// In-memory stand-in for the Asset Store adapter, with a call log so ordering is assertable.
function credentialSpy(events) {
  const secrets = new Map();
  let counter = 0;
  return {
    secrets,
    async save(token) {
      events.push('credential.save');
      if (!token.trim()) { throw new Error('请填写 Token'); }
      const reference = 'ref-' + (++counter);
      secrets.set(reference, token.trim());
      return reference;
    },
    async read(reference) {
      events.push('credential.read');
      if (!secrets.has(reference)) { throw new Error('安全凭据不存在，请重新填写 Token'); }
      return secrets.get(reference);
    },
    async remove(reference) { events.push('credential.remove'); secrets.delete(reference); }
  };
}

let passed = 0;
async function test(id, name, action) {
  const trace = [];
  let printed = false;
  const ui = {
    click(label, run) { trace.push(label); return run ? run() : undefined; },
    print() { if (!printed) { console.log(`[${id}] ${trace.join(' -> ')}`); printed = true; } }
  };
  try {
    await action(ui);
    ui.print();
    passed++;
    console.log(`PASS [${id}] ${name}`);
  } catch (error) {
    if (!printed) { console.log(`[${id}] ${trace.join(' -> ')}`); }
    throw error;
  }
}

async function main() {
  await test('F01', '导航点击与返回：tab、路由历史与聊天草稿按预期变化', async (ui) => {
    const { h, toasts } = openPage('NavHarness', ['nav']);
    const space = w.activeSpace(h.data);
    space.projects.push(project('p1', '学习'));
    const need = w.createNeed(space, '阅读计划', 'project', 'p1');
    const draft = '尚未发送的草稿';
    const tabs = [];
    const snap = {};
    h.scroller.currentOffset = () => ({ yOffset: 375 });
    await ui.click('tab 今日', () => { h.switchTab(0); tabs.push(h.tab); snap.homeOffset = h.offsets.get('local|0|'); });
    await ui.click('tab 项目', () => { h.switchTab(1); tabs.push(h.tab); });
    await ui.click('tab 阅读', () => { h.switchTab(2); tabs.push(h.tab); });
    await ui.click('tab 我的', () => { h.switchTab(3); tabs.push(h.tab); });
    await ui.click('tab 项目', () => { h.switchTab(1); tabs.push(h.tab); });
    await ui.click('项目卡片「项目详情与会话」', () => h.go('project/p1'));
    snap.routeInProject = h.route; snap.historyInProject = h.history.length;
    await ui.click('返回', () => h.back());
    snap.routeAfterBack = h.route; snap.tabAfterBack = h.tab;
    await ui.click('项目卡片「项目详情与会话」', () => h.go('project/p1'));
    await ui.click('「继续会话」', () => h.go('chat/' + need.id));
    await ui.click('在输入框输入草稿', () => { h.chatDraft = draft; });
    await ui.click('返回（离开会话）', () => { h.back(); snap.draftAfterLeave = h.chatDraft; snap.drafts = new Map(h.drafts); });
    await ui.click('tab 阅读（离开项目）', () => { h.switchTab(2); snap.historyAfterTab = h.history.length; snap.tabAfterTab = h.tab; });
    await ui.click('tab 项目', () => { h.switchTab(1); tabs.push(h.tab); });
    await ui.click('项目卡片「项目详情与会话」', () => h.go('project/p1'));
    await ui.click('「继续会话」（重新进入聊天）', () => { h.go('chat/' + need.id); snap.draftRestored = h.chatDraft; });
    await ui.click('返回', () => h.back());
    await ui.click('返回', () => { h.back(); snap.routeHome = h.route; });
    await ui.click('进入记录页', () => h.go('record'));
    const intercepted = h.onBackPress();
    snap.routeAfterSystemBack = h.route;
    ui.print();
    const chatKey = 'local|need|chat/' + need.id;
    assert.equal(tabs.slice(0, 5).join(','), '0,1,2,3,1', '点击四个主 tab 应依次切换且最后停留在项目 tab');
    assert.equal(snap.routeInProject, 'project/p1', '点击项目卡片应进入项目详情路由');
    assert.equal(snap.historyInProject, 1, '进入详情应把来源路由压入历史栈');
    assert.equal(snap.homeOffset, 375, '离开首页时应按路由记住列表滚动位置');
    assert.equal(snap.routeAfterBack, '', '项目详情返回一次应回到进入前的空路由');
    assert.equal(snap.tabAfterBack, 1, '详情返回后应回到原来的项目 tab');
    assert.equal(snap.draftAfterLeave, '', '离开聊天后当前输入应清空');
    assert.equal(snap.drafts.get(chatKey), draft, '离开聊天时应把草稿按会话键写入 drafts');
    assert.equal(snap.historyAfterTab, 0, '切换 tab 应清空历史栈');
    assert.equal(snap.tabAfterTab, 2, '切换 tab 后应停在阅读 tab');
    assert.equal(snap.draftRestored, draft, '返回同一会话应恢复未发送草稿');
    assert.equal(snap.routeHome, '', '连续返回两次应回到首页空路由');
    assert.equal(intercepted, true, '存在路由时系统返回应由页面处理');
    assert.equal(snap.routeAfterSystemBack, '', '系统返回处理一次后应回到首页');
    assert.equal(h.onBackPress(), false, '首页无路由时系统返回不应被拦截');
    assert.equal(toasts.length, 0, '纯导航点击不应弹出任何提示');
    w.validateWorkspace(h.data);
  });

  await test('F02', '计划状态点击：完成/恢复/进行中并持久化新快照', async (ui) => {
    const { h, toasts, saved } = openPage('PlanHarness', ['nav', 'commit', 'plan']);
    const space = w.activeSpace(h.data);
    const date = '2026-10-03';
    space.plans.push(plan('p2', date, '读书', 'todo'));
    space.plans.push(plan('p1', date, '写周报', 'todo', { priority: 'important' }));
    space.plans.push(plan('cal', date, '周会', 'todo', {
      calendarSource: { key: 'k-meeting', title: '周会', start: 1000, end: 2000, allDay: false }
    }));
    h.planDate = date;
    const original = h.data;
    const originalItem = w.activeSpace(original).plans.find((item) => item.id === 'p1');
    const counts = [];
    const savedItems = [];
    await ui.click('计划卡片「写周报 · 已完成」', async () => {
      await h.setPlan('p1', 'done');
      counts.push(w.planCounts(w.activeSpace(h.data), date).join('/'));
      savedItems.push(w.activeSpace(saved[saved.length - 1]).plans.find((item) => item.id === 'p1').status);
    });
    await ui.click('筛选项「已完成」', () => { h.planFilter = 'done'; });
    const doneOnly = h.visiblePlans().map((item) => item.id);
    const countsWhileFiltered = w.planCounts(w.activeSpace(h.data), date).join('/');
    await ui.click('计划卡片「写周报 · 待完成」', async () => {
      await h.setPlan('p1', 'todo');
      counts.push(w.planCounts(w.activeSpace(h.data), date).join('/'));
    });
    await ui.click('计划卡片「写周报 · 进行中」', async () => {
      await h.setPlan('p1', 'doing');
      counts.push(w.planCounts(w.activeSpace(h.data), date).join('/'));
    });
    let visibleOrder = [];
    await ui.click('筛选项「全部」', () => { h.planFilter = 'all'; visibleOrder = h.visiblePlans().map((item) => item.id); });
    await ui.click('计划卡片「已删除事项 · 已完成」', async () => { await h.setPlan('gone', 'done'); });
    const goneToast = lastToast(toasts);
    const savedAfterStatusClicks = saved.length;
    const nextDate = '2026-10-04';
    await ui.click('计划卡片「写周报 · 已完成」', async () => { await h.setPlan('p1', 'done'); });
    await ui.click('计划卡片「编辑 / 改期」', () => h.editPlan('p1'));
    await ui.click('改期到 2026-10-04 并保存', async () => { h.planEditDate = nextDate; await h.addPlan(); });
    const moved = w.activeSpace(h.data).plans.find((item) => item.id === 'p1');
    const countsAfterMove = { from: w.planCounts(w.activeSpace(h.data), date).join('/'), to: w.planCounts(w.activeSpace(h.data), nextDate).join('/') };
    ui.print();
    assert.equal(originalItem.status, 'todo', '点击完成不得改写点击前捕获的内存原稿');
    assert.notEqual(h.data, original, '提交后页面应持有新的工作区快照对象');
    assert.notEqual(saved[0], original, '写入本机的应是提交副本而不是内存原稿');
    assert.equal(savedItems.join(','), 'done', '点击完成时写入本机的计划状态应为 done');
    assert.equal(counts.join(' '), '1/0/1 0/0/2 0/1/1', '完成数/进行中/待完成应随每次点击变化且不含日历事项');
    assert.equal(countsWhileFiltered, '1/0/1', '界面筛选不应改变本机事务统计口径');
    assert.equal(doneOnly.join(','), 'p1', '筛选「已完成」时只应显示已完成事项');
    assert.equal(visibleOrder.join(','), 'p1,p2,cal', '重要事项在前，日历事项仍应出现在当日列表');
    assert.equal(visibleOrder.includes('cal'), true, '日历事项应出现在列表但不参与事务完成统计');
    assert.equal(savedAfterStatusClicks, 3, '三次有效状态点击应各触发一次持久化');
    assert.match(goneToast, /计划不存在/, '对不存在的事项点击状态应给出中文错误');
    assert.equal(saved.length, 5, '改期前的完成点击与改期保存应继续各写入一次');
    assert.equal(moved.date, nextDate, '编辑保存应把事项改到新日期');
    assert.equal(moved.status, 'done', '已完成事项改期后应保留完成状态');
    assert.equal(countsAfterMove.from, '0/0/1', '改期后原日期不再统计该事项');
    assert.equal(countsAfterMove.to, '1/0/0', '改期后新日期应计入已完成事项');
    w.validateWorkspace(saved[0]);
    w.validateWorkspace(saved[2]);
    w.validateWorkspace(saved[4]);
  });

  await test('F03', '非法计划操作：空标题、非法日期与错误用时应被拒绝且不写入', async (ui) => {
    const { h, toasts, saved } = openPage('PlanEditorHarness', ['nav', 'commit', 'plan']);
    const date = '2026-10-03';
    h.route = 'plans';
    h.planDate = date;
    await ui.click('每日计划「添加计划」', () => h.newPlan());
    const openedRoute = h.route;
    await ui.click('编辑页「添加到当日计划」（空标题）', async () => { await h.addPlan(); });
    const afterBlank = { count: w.activeSpace(h.data).plans.length, saves: saved.length, route: h.route };
    const blankToast = lastToast(toasts);
    await ui.click('输入标题', () => { h.planTitle = '有效事项'; });
    await ui.click('输入非法日期 2026-02-30 后保存', async () => { h.planEditDate = '2026-02-30'; await h.addPlan(); });
    const afterBadDate = { count: w.activeSpace(h.data).plans.length, saves: saved.length, title: h.planTitle };
    const dateToast = lastToast(toasts);
    await ui.click('修正日期后输入非数字用时保存', async () => { h.planEditDate = date; h.planMinutes = 'abc'; await h.addPlan(); });
    const minutesToast = lastToast(toasts);
    await ui.click('输入零分钟保存', async () => { h.planMinutes = '0'; await h.addPlan(); });
    const zeroToast = lastToast(toasts);
    await ui.click('选择不存在的项目保存', async () => { h.planMinutes = ''; h.planProject = 'missing'; await h.addPlan(); });
    const projectToast = lastToast(toasts);
    await ui.click('清空项目后保存', async () => { h.planProject = ''; await h.addPlan(); });
    const created = w.activeSpace(h.data).plans[0];
    const routeAfterSave = h.route;
    const savesAfterCreate = saved.length;
    const plansAfterInvalid = w.activeSpace(h.data).plans.length;
    w.activeSpace(h.data).plans.push(plan('cal', date, '周会', 'todo', {
      calendarSource: { key: 'k1', title: '周会', start: 1000, end: 2000, allDay: false }
    }));
    await ui.click('日历事项卡片「编辑 / 改期」', () => h.editPlan('cal'));
    await ui.click('把日历事项改到 2026-10-04 并保存', async () => { h.planEditDate = '2026-10-04'; await h.addPlan(); });
    const calendarToast = lastToast(toasts);
    const calendarDate = w.activeSpace(h.data).plans.find((item) => item.id === 'cal').date;
    const linked = w.createNeed(w.activeSpace(h.data), '周会讨论', 'plan', 'cal');
    w.activeSpace(h.data).links.push({ kind: 'plan', ownerId: 'cal', needId: linked.id });
    await ui.click('编辑页「移除计划事项」', () => { h.confirmPlanDelete = true; });
    const confirmShown = h.confirmPlanDelete;
    await ui.click('「保留事项」', () => { h.confirmPlanDelete = false; });
    const confirmCancelled = h.confirmPlanDelete;
    await ui.click('编辑页「移除计划事项」再次展开', () => { h.confirmPlanDelete = true; });
    await ui.click('「确认移除」', async () => { await h.deletePlan(); });
    const removed = {
      plans: w.activeSpace(h.data).plans.map((item) => item.id),
      kind: w.activeSpace(h.data).needs.find((item) => item.id === linked.id).ownerKind,
      links: w.activeSpace(h.data).links.length,
      route: h.route,
      saves: saved.length
    };
    const removeToast = lastToast(toasts);
    ui.print();
    assert.equal(openedRoute, 'plan-editor', '点击「添加计划」应打开编辑页');
    assert.equal(afterBlank.count, 0, '空标题保存不得新增计划');
    assert.equal(afterBlank.saves, 0, '空标题保存不得写入本机');
    assert.equal(afterBlank.route, 'plan-editor', '保存失败应停留在编辑页保留输入');
    assert.match(blankToast, /请先输入内容/, '空标题应提示中文错误');
    assert.equal(afterBadDate.count, 0, '非法日期保存不得新增计划');
    assert.equal(afterBadDate.saves, 0, '非法日期保存不得写入本机');
    assert.equal(afterBadDate.title, '有效事项', '保存失败应保留已输入标题');
    assert.match(dateToast, /有效日期/, '非法日期应提示日期格式错误');
    assert.match(minutesToast, /预计用时/, '非数字用时应提示整数校验');
    assert.match(zeroToast, /预计用时/, '零分钟应提示必须大于 0');
    assert.match(projectToast, /项目/, '无效项目应提示项目不存在');
    assert.equal(saved.length, 2, '合法新增与确认移除应各写入一次本机');
    assert.equal(savesAfterCreate, 1, '非法保存不应写入本机，只有最后一次合法保存写入');
    assert.equal(plansAfterInvalid, 1, '非法保存后原计划数量应保持不变');
    assert.equal(created.title, '有效事项', '保存时应去除标题首尾空白');
    assert.equal(created.status, 'todo', '新建计划默认状态应为待完成');
    assert.equal(created.date, date, '新建计划应落在编辑页所选日期');
    assert.equal(routeAfterSave, 'plans', '保存成功后应返回计划列表');
    assert.match(calendarToast, /日历事项不能改期/, '日历来源事项改期应被拒绝并说明原因');
    assert.equal(calendarDate, date, '被拒绝的改期不得改变日历事项原日期');
    assert.equal(confirmShown, true, '点击移除应先展开就地确认');
    assert.equal(confirmCancelled, false, '点击保留应关闭移除确认且不删除');
    assert.equal(removed.plans.includes('cal'), false, '确认移除后本机计划应删除该事项');
    assert.equal(removed.kind, 'independent', '移除计划后关联会话应保留为独立需求');
    assert.equal(removed.links, 0, '移除计划后应删除该来源链接');
    assert.equal(removed.route, 'plans', '移除成功后应返回计划列表');
    assert.equal(removed.saves, 2, '移除操作应单独持久化一次');
    assert.match(removeToast, /关联会话保留/, '移除提示应说明关联会话保留');
    w.validateWorkspace(saved[0]);
  });

  await test('F04', '日历导入点击：只导入勾选项、跳过重复并拒绝日期已变化的导入', async (ui) => {
    const calendarState = { entries: [], calls: [], failure: null };
    const globals = {
      readCalendarEntries: async (_context, date) => {
        calendarState.calls.push(date);
        if (calendarState.failure) { throw calendarState.failure; }
        return calendarState.entries.map((entry) => ({ ...entry }));
      },
      calendarText: () => '今日日历暂无日程',
      deviceSnapshot: () => '电量 88% · 本地时间 2026-10-03 09:00'
    };
    const { h, toasts, saved } = openPage('CalendarHarness', ['nav', 'commit', 'plan', 'calendar'], globals);
    const date = '2026-10-03';
    const nextDate = '2026-10-04';
    const entries = [
      { key: 'cal-1/11/1000', title: '周会', start: new Date('2026-10-03T09:00:00').getTime(),
        end: new Date('2026-10-03T10:00:00').getTime(), allDay: false },
      { key: 'cal-1/12/3000', title: '评审', start: new Date('2026-10-03T14:00:00').getTime(),
        end: new Date('2026-10-03T15:30:00').getTime(), allDay: false }
    ];
    calendarState.entries = entries;
    h.planDate = date;
    await ui.click('每日计划「授权并刷新所选日期日历」', async () => { await h.loadCalendarDate(date); });
    const loaded = { date: h.calendarDate, count: h.calendarEntries.length, selection: h.calendarSelection.length };
    await ui.click('勾选日历项「周会」', () => { h.calendarSelection = h.calendarSelection.concat(entries[0].key); });
    await ui.click('「确认加入所选日程」', async () => { await h.importCalendar(); });
    const imported = w.activeSpace(h.data).plans.map((item) => item.id);
    const importedSource = w.activeSpace(h.data).plans[0].calendarSource.key;
    const importedBusy = w.calendarBusyMinutes(w.activeSpace(h.data), date);
    const importedCounts = w.planCounts(w.activeSpace(h.data), date).join('/');
    const firstToast = lastToast(toasts);
    const selectionAfterImport = h.calendarSelection.length;
    await ui.click('再次勾选已导入的「周会」', () => { h.calendarSelection = [entries[0].key]; });
    await ui.click('「确认加入所选日程」（重复）', async () => { await h.importCalendar(); });
    const afterDuplicate = w.activeSpace(h.data).plans.length;
    const duplicateToast = lastToast(toasts);
    await ui.click('把查看日期改为 2026-10-04', () => { h.changePlanDate(nextDate); });
    const selectionAfterDateChange = h.calendarSelection.length;
    await ui.click('勾选「评审」（查看日期已变化）', () => { h.calendarSelection = [entries[1].key]; });
    const savesBeforeMismatch = saved.length;
    await ui.click('「确认加入所选日程」（日期不匹配）', async () => { await h.importCalendar(); });
    const afterMismatch = { count: w.activeSpace(h.data).plans.length, saves: saved.length };
    const mismatchToast = lastToast(toasts);
    const savesBeforeEmpty = saved.length;
    await ui.click('清空勾选后再次导入', async () => { h.calendarSelection = []; await h.importCalendar(); });
    const savesAfterEmpty = saved.length;
    await ui.click('刷新日历（权限失败）', async () => {
      calendarState.failure = new Error('未获得读取手机日历的权限，请检查系统设置');
      await h.loadCalendarDate(date);
    });
    const failed = { error: h.calendarError, count: h.calendarEntries.length, date: h.calendarDate, capturedAt: h.snapshot.capturedAt };
    ui.print();
    assert.equal(loaded.date, date, '点击刷新后应记录真实请求日期');
    assert.equal(loaded.count, 2, '应展示该日期读取到的全部日历候选');
    assert.equal(loaded.selection, 0, '刷新后不应预选任何日程');
    assert.equal(imported.length, 1, '只应导入勾选的那一条日程');
    assert.equal(importedSource, entries[0].key, '导入的计划应保留日历实例来源 key');
    assert.equal(importedBusy, 60, '导入一小时后应只统计该日历事项占用 60 分钟');
    assert.equal(importedCounts, '0/0/0', '日历事项不应计入事务完成统计');
    assert.match(firstToast, /已加入 1 条计划/, '导入成功应提示加入数量');
    assert.equal(selectionAfterImport, 0, '导入成功后应清空勾选状态');
    assert.equal(afterDuplicate, 1, '重复点击导入应跳过同一日历实例');
    assert.match(duplicateToast, /已加入 0 条计划/, '重复导入应提示 0 条并说明跳过');
    assert.equal(selectionAfterDateChange, 0, '切换查看日期应清空日历勾选');
    assert.equal(afterMismatch.count, 1, '查看日期与计划日期不一致时不得导入');
    assert.equal(afterMismatch.saves, savesBeforeMismatch, '拒绝导入时不应产生额外写入');
    assert.match(mismatchToast, /查看日期已变化/, '日期不一致应提示刷新对应日历');
    assert.equal(savesAfterEmpty, savesBeforeEmpty, '未勾选任何日程时点击导入不应写入');
    assert.match(failed.error, /权限/, '日历读取失败应就地保留中文错误原因');
    assert.equal(failed.count, 0, '读取失败不得把旧候选列表当成刷新成功');
    assert.equal(failed.date, '', '读取失败不得标记为已刷新日期');
    assert.equal(failed.capturedAt, 0, '读取失败应清空旧快照采集时间');
    w.validateWorkspace(saved[0]);
  });

  await test('F05', '连接保存点击：非法地址不触达凭据，保存失败保留旧凭据', async (ui) => {
    const { h, toasts, saved } = openPage('ConnectionHarness', ['nav', 'forms', 'commit', 'connection', 'fill']);
    const events = [];
    const credentials = credentialSpy(events);
    h.credentials = credentials;
    h.repository = { save: async (value) => { events.push('repository.save'); saved.push(value); } };
    h.name = 'Home'; h.protocol = 'https'; h.port = '443'; h.basePath = ''; h.model = 'hermes-agent'; h.token = 'first-token';
    await ui.click('管理连接「保存并连接」（非法地址）', async () => { h.host = 'a@b.com'; await h.saveConnection(true); });
    const invalid = { credentialEvents: events.length, saves: saved.length, connection: h.data.connection, busy: h.busy };
    const invalidToast = lastToast(toasts);
    await ui.click('填入合法地址后「保存并连接」', async () => {
      h.host = 'example.org';
      h.client = { check: async () => {}, chat: async () => 'answer', stop() {} };
      await h.saveConnection(true);
    });
    const reference = h.data.connection.credentialRef;
    const storedToken = await credentials.read(reference);
    const successOrder = events.slice(0, 2).join(' -> ');
    const successToastCount = toasts.length;
    const savedConnection = h.data.connection.host;
    const status = h.connectionStatus;
    let checkCalls = 0;
    let checkArgs = null;
    h.client = { check: async (settings, token) => { checkCalls++; checkArgs = { url: settings.baseUrl, token: token }; }, chat: async () => 'answer', stop() {} };
    const savesBeforeTest = saved.length;
    await ui.click('「测试当前输入」（非法地址）', async () => { h.host = 'bad host'; await h.testConnection(); });
    const checksAfterInvalid = checkCalls;
    await ui.click('「测试当前输入」（合法地址）', async () => { h.host = 'example.org'; await h.testConnection(); });
    const checksAfterValid = checkCalls;
    const testToast = lastToast(toasts);
    const savesAfterTest = saved.length;
    await ui.click('「测试当前输入」（服务返回失败）', async () => {
      h.client = { check: async () => { throw new Error('连接检测失败：HTTP 500'); } };
      await h.testConnection();
    });
    const testFailureToast = lastToast(toasts);
    const testBusy = h.busy;
    const previousRef = h.data.connection.credentialRef;
    const previousToken = await credentials.read(previousRef);
    const secretsBefore = credentials.secrets.size;
    const savedBefore = h.data;
    await ui.click('改名后「保存配置」（落盘失败）', async () => {
      h.host = 'second.example.org'; h.token = 'replacement-token';
      h.repository.save = async () => { throw new Error('disk failure'); };
      await h.saveConnection(false);
    });
    const failureToast = lastToast(toasts);
    const failure = { secrets: credentials.secrets.size, oldToken: await credentials.read(previousRef), sameData: h.data === savedBefore, host: h.data.connection.host };
    await ui.click('改为第三台服务器后「保存并连接」（认证失败）', async () => {
      h.repository.save = async () => {};
      h.credentials = credentialSpy(events);
      h.host = 'third.example.org'; h.token = 'third-token';
      h.client = { check: async () => { throw new Error('认证失败，请检查 Token'); } };
      await h.saveConnection(true);
    });
    const connectFailure = { status: h.connectionStatus, host: h.data.connection.host, token: await h.credentials.read(h.data.connection.credentialRef) };
    const connectFailureToast = lastToast(toasts);
    ui.print();
    assert.equal(invalid.credentialEvents, 0, '地址非法时不得触达凭据存储');
    assert.equal(invalid.saves, 0, '地址非法时不得写入工作区');
    assert.equal(invalid.connection, null, '地址非法时不应改写当前连接配置');
    assert.equal(invalid.busy, false, '失败的保存应复位保存锁');
    assert.match(invalidToast, /域名/, '非法地址应给出中文地址提示');
    assert.ok(reference, '保存成功后应生成安全凭据引用');
    assert.equal(storedToken, 'first-token', '保存成功应把 Token 写入安全凭据');
    assert.equal(successOrder, 'credential.save -> repository.save', '应先写安全凭据再保存工作区');
    assert.equal(savedConnection, 'example.org', '保存成功应把新地址写入工作区');
    assert.match(status, /业务同步待接入/, '连接成功应区分认证成功与业务同步');
    assert.ok(toasts.slice(0, successToastCount).some((item) => /配置与安全凭据已保存/.test(item.message)), '保存成功应提示配置与凭据已保存');
    assert.equal(checksAfterInvalid, 0, '非法地址的测试连接不应发起请求');
    assert.equal(checksAfterValid, 1, '合法地址只应发起一次测试连接');
    assert.equal(checkArgs.url, 'https://example.org:443/v1', '测试连接应使用规范化后的服务地址');
    assert.equal(checkArgs.token, 'first-token', '测试连接应使用当前输入 Token');
    assert.match(testToast, /测试通过/, '测试通过应提示未保存也未同步');
    assert.equal(savesAfterTest, savesBeforeTest, '测试连接不得写入本机配置');
    assert.match(testFailureToast, /连接检测失败/, '测试失败应回显服务错误');
    assert.equal(testBusy, false, '测试连接结束应复位保存锁');
    assert.match(failureToast, /旧配置仍有效/, '落盘失败应提示旧配置仍有效');
    assert.equal(failure.secrets, secretsBefore, '保存失败应移除本次新凭据而不残留');
    assert.equal(failure.oldToken, previousToken, '保存失败不得覆盖旧凭据');
    assert.equal(failure.sameData, true, '保存失败不应替换页面数据快照');
    assert.equal(failure.host, 'example.org', '保存失败后工作区地址应保持旧值');
    assert.match(connectFailure.status, /连接失败/, '保存后连接失败应显示连接失败状态');
    assert.equal(connectFailure.host, 'third.example.org', '连接失败不应回滚已保存的配置');
    assert.equal(connectFailure.token, 'third-token', '连接失败不应丢失已保存的凭据');
    assert.match(connectFailureToast, /认证失败/, '连接失败应回显认证错误原因');
  });

  await test('F06', '发送点击：等待中重复点击只发一次，失败后保留输入再发一次', async (ui) => {
    const { h, toasts, saved } = openPage('SendHarness', ['nav', 'commit', 'connection', 'send']);
    w.selectConnection(h.data, connection());
    const need = w.createNeed(w.activeSpace(h.data), 'Chat', 'independent', '');
    h.route = 'chat/' + need.id;
    h.chatDraft = 'hello';
    h.selectedNeed = () => w.activeSpace(h.data).needs.find((item) => item.id === h.route.split('/')[1]);
    let finish;
    let calls = 0;
    h.client = { chat: () => { calls++; return new Promise((resolve) => { finish = resolve; }); }, stop() {} };
    const running = ui.click('点击发送气泡', () => h.send());
    await tick();
    const pending = { prompt: h.pendingPrompt, key: h.pendingKey, sending: h.sending, messages: h.selectedNeed().messages.length };
    await ui.click('等待中再次点击发送', () => h.send());
    await tick();
    const callsWhileWaiting = calls;
    finish('answer');
    await running;
    const done = { calls: calls, sending: h.sending, draft: h.chatDraft, pending: h.pendingPrompt, messages: h.selectedNeed().messages.length };
    const roles = h.selectedNeed().messages.map((message) => message.role).join(',');
    h.chatDraft = 'again';
    let failures = 0;
    h.client = { chat: async () => { failures++; throw new Error('连接中断或超时。服务端可能仍在执行，请确认后再重试'); }, stop() {} };
    await ui.click('失败场景点击发送气泡', async () => { await h.send(); });
    const failed = { draft: h.chatDraft, error: h.sendError, sending: h.sending, messages: h.selectedNeed().messages.length, saves: saved.length };
    await ui.click('失败后再次点击发送', async () => { await h.send(); });
    const failedToast = lastToast(toasts);
    ui.print();
    assert.equal(pending.prompt, 'hello', '点击发送后应立刻显示等待中的用户气泡内容');
    assert.equal(pending.key, h.routeKey(), '等待气泡应绑定当前会话路由键');
    assert.equal(pending.sending, true, '等待回复期间应处于发送中状态');
    assert.equal(pending.messages, 0, '等待期间不应提前写入正式历史');
    assert.equal(callsWhileWaiting, 1, '等待中重复点击发送不应发起第二次请求');
    assert.equal(done.calls, 1, '一次点击只应产生一次网络请求');
    assert.equal(done.sending, false, '成功后应复位发送中状态');
    assert.equal(done.draft, '', '成功后应清空输入框');
    assert.equal(done.pending, '', '成功后应收起等待气泡');
    assert.equal(done.messages, 2, '成功应答应恰好写入一组问答');
    assert.equal(roles, 'user,assistant', '写入历史的应是用户提问与 AI 回复');
    assert.equal(saved.length, 1, '成功后应恰好持久化一次新快照');
    assert.equal(w.activeSpace(saved[0]).needs[0].messages.length, 2, '持久化快照应包含完整问答');
    assert.equal(need.messages.length, 0, '发送不得污染进入前的旧会话对象');
    assert.equal(failed.draft, 'again', '发送失败应保留输入内容');
    assert.match(failed.error, /连接中断或超时/, '发送失败应保留可读错误');
    assert.equal(failed.sending, false, '失败后应复位发送中状态');
    assert.equal(failed.messages, 2, '失败不应追加任何消息');
    assert.equal(failed.saves, 1, '失败不应再次写入本机');
    assert.equal(failures, 2, '失败后再次点击应重新发起请求');
    assert.match(failedToast, /连接中断或超时/, '失败提示应展示服务错误原因');
  });

  console.log(`\n${passed} interactive flow tests passed; Index.ets methods driven by simulated clicks, platform APIs mocked, not device acceptance.`);
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
