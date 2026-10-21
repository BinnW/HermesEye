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
const reading = load('core/Reading.ts');
const w = load('core/Workspace.ts', { './Domain': domain, './Reading': reading });
const businessSync = load('core/BusinessSync.ts', { './Workspace': w });
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
  send: { from: '  private async send()', to: '  private async refreshCalendar(' },
  project: { from: '  private projectTaskSummary(', to: '  @Styles\n  surface()' }
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
  projectBrief: w.projectBrief, projectKindLabel: w.projectKindLabel, projectStatusLabel: w.projectStatusLabel,
  showToast: presentation.showToast, applySystemAppearance: () => {}, ConnectionService: ConnectionService
};

// ProjectPanel.ets 的项目详情/编辑交互方法同样无法直接 import（ArkUI 装饰器），
// 用与 Index.ets 相同的切片 + VM 注入方式驱动；平台能力只有 this.save 回调，由用例注入。
const panelPath = path.join(__dirname, '../entry/src/main/ets/components/ProjectPanel.ets');
const panelSource = fs.readFileSync(panelPath, 'utf8');
function makePanel(name) {
  const from = panelSource.indexOf('  aboutToAppear(): void');
  const to = panelSource.indexOf('  @Styles\n  card()');
  if (from < 0 || to <= from) { throw new Error('ProjectPanel.ets 切片失败'); }
  const body = panelSource.slice(from, to);
  const source = `class ${name} {\n${body}\n}\nexports.${name} = ${name};`;
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2021, module: ts.ModuleKind.CommonJS } }).outputText;
  const sandbox = {
    exports: {}, setTimeout, clearTimeout, newId: w.newId,
    saveProject: w.saveProject, changeProjectStatus: w.changeProjectStatus, addProjectMilestone: w.addProjectMilestone,
    setProjectMilestone: w.setProjectMilestone, addProjectReview: w.addProjectReview,
    projectDraft: w.projectDraft, ProjectDraft: w.ProjectDraft
  };
  vm.runInNewContext(compiled, sandbox, { filename: panelPath });
  return sandbox.exports[name];
}

// 面板靶机：data 是真实工作区，save 走真实规则并记录每次落盘，便于断言"点击后到底写了什么"。
function openPanel(options = {}) {
  const Panel = makePanel('PanelHarness');
  const h = new Panel();
  h.data = w.newWorkspace();
  const space = w.activeSpace(h.data);
  if (options.project) { space.projects.push(options.project); }
  h.project = options.project;
  h.writable = options.writable !== false;
  h.server = options.server || 'local';
  h.drafts = options.drafts || new Map(); h.sections = new Map();
  h.draft = options.project ? w.projectDraft(options.project) : new w.ProjectDraft();
  h.editing = !options.project;
  h.section = 'overview';
  h.confirmation = '';
  h.fieldRevision = 0;
  const saved = [];
  const opened = [];
  h.save = async (change) => { change(space); saved.push(w.copyWorkspace(h.data)); return true; };
  h.opened = (id) => { opened.push(id); };
  h.discuss = () => {};
  return { h, space, saved, opened };
}

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
  h.contextDrafts = new Map(); h.drafts = new Map(); h.offsets = new Map(); h.formDrafts = new Map(); h.projectDrafts = new Map();
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
  h.projectQuery = ''; h.projectFilter = 'active';
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

// 真实 BusinessClient + 注入的 HTTP 适配器：既能断言"未触达网络"，也能驱动真实请求与解析路径。
function httpAdapter(log, routes) {
  return { http: { RequestMethod: { GET: 'GET', POST: 'POST' }, HttpDataType: { STRING: 'string' },
    createHttp: () => ({
      async request(url) {
        log.push(url);
        const suffix = url.replace(/^https?:\/\/[^/]+/, '');
        const route = routes[suffix];
        if (!route) { throw new Error('未预期请求 ' + suffix); }
        return route;
      },
      destroy() { log.push('destroy'); }
    }) } };
}
function businessClient(kit) {
  return load('services/BusinessClient.ets', { '@kit.NetworkKit': kit, '../core/Domain': domain }).BusinessClient;
}
function readingEntry(id, kind = 'thought', text = '想法正文', location = '第一章') { return { id, kind, text, location }; }
function readingBook(id, extra = {}) {
  return { id, title: '书-' + id, source: '微信读书', updatedAt: 1, sourceUpdatedAt: null, progress: null,
    progressUnit: 'percent', entries: [], questions: [], cycles: [], organized: '', ...extra };
}
function readingSnapshot(overrides = {}) {
  const books = overrides.books || [readingBook('b1')];
  const policy = { enabled: false, bookIds: books.map((item) => item.id), intervalHours: 24,
    timezone: 'Asia/Shanghai', consent: false, ...(overrides.policy || {}) };
  const snapshot = { books, policy, sourceConfigured: overrides.sourceConfigured === undefined ? true : overrides.sourceConfigured };
  if (overrides.collections) { snapshot.collections = overrides.collections; }
  return snapshot;
}
// ReadingPanel 靶机：切片与 F09 完全一致，因此 V8 函数区间相同，覆盖按进程合并而不是重复计数。
function openReading(globals = {}, overrides = {}) {
  const h = componentHandlers('ReadingPanel', '  aboutToAppear()', '  @Styles', {
    validateReadingSnapshot: reading.validateReadingSnapshot, newId: w.newId, ...globals
  });
  Object.assign(h, { busy: false, connected: false, serverId: '', workspaceId: '', books: [], collections: [],
    root: '', token: '', allowHttp: false, spaceKey: 'local', message: '', bookIds: '', interval: '24',
    timezone: 'Asia/Shanghai', scheduleEnabled: false, consent: false, selectedBook: '', selectedEntry: '',
    entryLimit: 20, questionLimit: 20, questionText: '', quote: '', nextAt: 0, sourceConfigured: false,
    initial: undefined, client: undefined, identity: undefined, cache: async () => true }, overrides);
  return h;
}
// BusinessPanel 切片：A 覆盖 aboutToAppear/loadOffline/connect/act/createPlan，B 覆盖 exportProject/deletePlan/send。
function businessPanelA(globals) {
  return componentHandlers('BusinessPanel', '  aboutToAppear()', '  private async exportProject', globals);
}
function businessPanelB(globals) {
  return componentHandlers('BusinessPanel', '  private async exportProject', '  build()', globals);
}
function businessPanelFields(overrides = {}) {
  return { project: undefined, root: '', token: '', allowHttp: false, busy: false, connected: false, localReady: false,
    title: '', prompt: '', needId: '', replica: businessSync.newBusinessState({ protocolVersion: 1, serverId: 'unbound',
      workspaceId: 'unbound' }, 'unbound'), coordinator: undefined, status: '独立业务副本，不会自动上传旧计划、日历或历史对话。',
    getUIContext: () => ({ getHostContext: () => ({ filesDir: '/sandbox' }) }), ...overrides };
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

function componentHandlers(name, from, to, globals) {
  const file = path.join(__dirname, '../entry/src/main/ets/components', name + '.ets');
  const source = fs.readFileSync(file, 'utf8');
  const methods = source.slice(source.indexOf(from), source.indexOf(to));
  const compiled = ts.transpileModule('class Harness {' + methods + '} exports.Harness = Harness;', {
    compilerOptions: { target: ts.ScriptTarget.ES2021, module: ts.ModuleKind.CommonJS }
  }).outputText;
  const sandbox = { exports: {}, ...globals };
  vm.runInNewContext(compiled, sandbox, { filename: file });
  return new sandbox.exports.Harness();
}

async function main() {
  await test('F09', '阅读交互：身份隔离、缓存失败、明确授权与逐条问题', async ui => {
    const reading = load('core/Reading.ts');
    const entry = { id: 'e1', kind: 'thought', text: 'My note', location: 'chapter1' };
    const snapshot = { books: [{ id: 'b1', title: 'B', source: '微信读书', updatedAt: 1, sourceUpdatedAt: null,
      progress: null, progressUnit: 'percent', entries: [entry], questions: [], cycles: [], organized: '' }],
      policy: { enabled: false, bookIds: ['b1'], intervalHours: 24, timezone: 'Asia/Shanghai', consent: false }, sourceConfigured: true };
    let identity = { protocolVersion: 1, serverId: 's1', workspaceId: 'w1' }, diskFail = false, failRead = false;
    const requests = [];
    class Client {
      async identity() { return identity; }
      async reading() { if (failRead) throw Error('offline'); return JSON.parse(JSON.stringify(snapshot)); }
      async readingPolicy(policy) { requests.push(['policy', policy]); snapshot.policy = JSON.parse(JSON.stringify(policy)); }
      async collectReading(request) { requests.push(['collect', request]); }
      async readingQuestion(question) { requests.push(['question', question]); return question; }
      async readingAnswer(answer) { requests.push(['answer', answer]); return { state: 'unknown' }; }
    }
    const h = componentHandlers('ReadingPanel', '  aboutToAppear()', '  @Styles', {
      BusinessClient: Client, validateReadingSnapshot: reading.validateReadingSnapshot, newId: w.newId
    });
    Object.assign(h, { busy: false, connected: false, serverId: 's1', workspaceId: 'w1', books: [], root: 'https://example.org',
      token: 'memory-only', allowHttp: false, spaceKey: 'local', cache: async (_snapshot, _identity, spaceKey) => {
        assert.equal(spaceKey, 'local', '缓存必须携带请求发起空间，不能沿用切换后的空间'); return !diskFail; } });
    await ui.click('连接并读取副本', () => h.connect());
    assert.equal(h.connected, true); assert.equal(h.token, ''); assert.equal(h.books[0].progress, null);
    h.selectedBook = 'b1'; h.selectedEntry = 'e1'; h.questionText = 'Why?'; h.quote = entry.text;
    await ui.click('确认来源并提问', () => h.act(c => h.ask(c)));
    assert.equal(requests[0][0], 'question'); assert.equal(requests[1][0], 'answer');
    assert.equal(requests[1][1].questionId, requests[0][1].id); assert.equal(h.questionText, '');
    h.bookIds = 'b1, b2, '; h.interval = '12'; h.timezone = 'Asia/Shanghai'; h.consent = true; h.scheduleEnabled = true;
    await ui.click('保存范围与周期', () => h.act(c => h.savePolicy(c)));
    assert.deepEqual(JSON.parse(JSON.stringify(requests[2][1])), { enabled: true, bookIds: ['b1', 'b2'],
      intervalHours: 12, timezone: 'Asia/Shanghai', consent: true });
    await ui.click('确认当前范围并采集', () => h.act(c => h.collect(c)));
    assert.equal(requests[3][0], 'policy'); assert.equal(requests[4][0], 'collect');
    assert.equal(requests[3][1].bookIds.join(','), 'b1,b2');
    h.selectedEntry = ''; h.questionText = 'X';
    await h.act(c => h.ask(c)); assert.match(h.message, /选择来源/); assert.equal(h.questionText, 'X');
    diskFail = true; await h.act(async () => {}); assert.match(h.message, /本机保存失败/); assert.equal(h.books[0].title, 'B');
    diskFail = false; failRead = true; await h.act(async () => {}); assert.match(h.message, /offline/);
    failRead = false; identity = { ...identity, serverId: 'other' }; h.connected = false;
    await h.connect(); assert.match(h.message, /身份/); assert.equal(h.connected, false);
    h.busy = true; await h.connect(); await h.act(async () => assert.fail('overlap'));
    h.busy = false; h.client = undefined; await h.act(async () => assert.fail('offline write'));
    await assert.rejects(() => h.refresh(), /先连接/);
  });
  await test('F10', '项目业务会话：目标资料显式入队，发送只使用当前项目 Need', async ui => {
    const h = componentHandlers('BusinessPanel', '  private async exportProject', '  build()', { newId: w.newId });
    const p = { ...project('p1', '学习'), kind: 'learning', status: 'active', criteria: 'Explain',
      targetDate: '', milestones: [{ id: 'm1', title: 'Step', dueDate: '', done: false }],
      reviews: [{ id: 'r1', text: 'Actual evidence', createdAt: 1 }] };
    h.project = p; h.replica = { deviceId: 'd1', entities: [{ id: 'p1', kind: 'project', revision: 2 }] };
    const writes = []; const c = { edit: async mutation => writes.push(mutation), send: async intent => writes.push(intent) };
    await ui.click('确认当前项目加入待同步列表', () => h.exportProject(c));
    assert.equal(writes[0].baseRevision, 2); assert.equal(writes[0].payload.reviews[0].text, 'Actual evidence');
    assert.equal('calendarSource' in writes[0].payload, false); assert.equal('messages' in writes[0].payload, false);
    h.needId = 'project-p1'; h.prompt = 'Preview I explicitly confirmed';
    await ui.click('保存意图并发送', () => h.send(c));
    assert.equal(writes[1].needId, 'project-p1'); assert.equal(writes[1].input, 'Preview I explicitly confirmed');
    assert.equal(h.prompt, ''); h.project = undefined;
    await assert.rejects(() => h.exportProject(c), /项目已不存在/);
    h.needId = 'bad/id'; await assert.rejects(() => h.send(c), /会话标识/);
  });

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
    assert.equal(counts.join(' '), '1/0/2 0/0/3 0/1/2', '完成数/进行中/待完成应随每次点击变化，日历事项计入统计');
    assert.equal(countsWhileFiltered, '1/0/2', '界面筛选不应改变本机事务统计口径');
    assert.equal(doneOnly.join(','), 'p1', '筛选「已完成」时只应显示已完成事项');
    assert.equal(visibleOrder.join(','), 'p1,p2,cal', '重要事项在前，日历事项仍应出现在当日列表');
    assert.equal(visibleOrder.includes('cal'), true, '日历事项应出现在列表并参与事务完成统计');
    assert.equal(savedAfterStatusClicks, 3, '三次有效状态点击应各触发一次持久化');
    assert.match(goneToast, /计划不存在/, '对不存在的事项点击状态应给出中文错误');
    assert.equal(saved.length, 5, '改期前的完成点击与改期保存应继续各写入一次');
    assert.equal(moved.date, nextDate, '编辑保存应把事项改到新日期');
    assert.equal(moved.status, 'done', '已完成事项改期后应保留完成状态');
    assert.equal(countsAfterMove.from, '0/0/2', '改期后原日期不再统计该事项，日历事项保留');
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
    assert.equal(importedCounts, '0/0/1', '日历事项计入事务完成统计');
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

  await test('F07', '项目列表点击：状态筛选、搜索与「与 Hermes 推进目标」草稿', async (ui) => {
    const { h } = openPage('ProjectListHarness', ['nav', 'project']);
    const space = w.activeSpace(h.data);
    space.projects.push(
      { id: 'p1', name: 'ArkTS 进阶', goal: '学会并发与状态管理', managedBy: 'manual', nextStep: '读官方文档', kind: 'learning', status: 'active' },
      { id: 'p2', name: '晨跑', goal: '每周三次五公里', managedBy: 'manual', nextStep: '', kind: 'fitness', status: 'paused' },
      { id: 'p3', name: '上线小工具', goal: '发布给同事使用', managedBy: 'agent', nextStep: '', kind: 'software', status: 'completed' },
      { id: 'p4', name: '旧目标', goal: '已放弃', managedBy: 'manual', nextStep: '', status: 'archived' },
      { id: 'p5', name: '历史项目', goal: '没有状态字段', managedBy: 'manual', nextStep: '' });
    space.plans.push(
      plan('t1', h.planDate, '读第三章', 'done', { projectId: 'p1' }),
      plan('t2', h.planDate, '写示例', 'done', { projectId: 'p1' }),
      plan('t3', h.planDate, '整理笔记', 'todo', { projectId: 'p1' }),
      plan('t4', h.planDate, '日历事项', 'todo', { projectId: 'p1', calendarSource: { key: 'k', title: '周会', start: 1, end: 2, allDay: false } }),
      plan('t5', h.planDate, '别的项目任务', 'done', { projectId: 'p2' }));
    const ids = (list) => list.map((item) => item.id).join(',');

    await ui.click('进入项目页（默认进行中筛选）', () => { h.switchTab(1); });
    const defaultList = ids(h.visibleProjects());
    await ui.click('切换筛选「已暂停」', () => { h.projectFilter = 'paused'; });
    const pausedList = ids(h.visibleProjects());
    await ui.click('切换筛选「全部」', () => { h.projectFilter = 'all'; });
    const allList = ids(h.visibleProjects());
    await ui.click('搜索「ARKTS」', () => { h.projectQuery = '  ARKTS  '; });
    const searched = ids(h.visibleProjects());
    await ui.click('搜索「每周三次」（命中目标字段）', () => { h.projectQuery = '每周三次'; });
    const goalSearch = ids(h.visibleProjects());
    await ui.click('清空搜索', () => { h.projectQuery = ''; });
    const summary = h.projectTaskSummary(space.projects[0]);
    const otherSummary = h.projectTaskSummary(space.projects[1]);
    const longName = '很长的项目名称'.repeat(20);
    await ui.click('点击「与 Hermes 推进目标」', () => { h.discussProject({ ...space.projects[0], name: longName }); });
    const discuss = { project: h.needProject, name: h.needName, description: h.needDescription, route: h.route };

    assert.equal(h.tab, 1, '点击项目 tab 后应停在项目页');
    assert.equal(defaultList, 'p1,p5', '默认筛选为进行中，且缺 status 的旧项目按进行中展示');
    assert.equal(pausedList, 'p2', '状态筛选应只返回对应状态');
    assert.equal(allList, 'p1,p2,p3,p4,p5', '「全部」应不隐藏任何项目');
    assert.equal(searched, 'p1', '搜索应先去空白并忽略大小写，命中名称或目标');
    assert.equal(goalSearch, 'p2', '搜索应同时匹配目标字段，不受名称影响');
    assert.equal(summary, '已完成 2 / 3 项本机任务（不含日历）', '任务摘要只统计本项目非日历事项');
    assert.equal(otherSummary, '已完成 1 / 1 项本机任务（不含日历）', '任务摘要按项目隔离');
    assert.equal(discuss.project, 'p1', '推进目标应把需求归属设为该项目');
    assert.equal(discuss.name.length, 90 + ' · 目标推进'.length, '需求名应截断到 90 字符再加固定后缀');
    assert.ok(discuss.name.endsWith(' · 目标推进'), '需求名应带可识别的推进后缀');
    assert.ok(discuss.description.includes('请帮助我推进这个项目'), '需求描述应是项目摘要草稿');
    assert.equal(discuss.route, 'new-need', '点击后应进入新需求编辑页，不直接发送');
    assert.equal(space.needs.length, 0, '仅生成草稿，不得自动建立会话');
  });

  await test('F08', '项目详情点击：新建、状态流转、里程碑与复盘', async (ui) => {
    const created = openPanel();
    await ui.click('填写名称', () => { created.h.draft.name = '  新项目  '; });
    await ui.click('选择类型「软件构建」', () => { created.h.draft.kind = 'software'; });
    await ui.click('填写目标', () => { created.h.draft.goal = '做一个可用的原型'; });
    await ui.click('填写完成标准', () => { created.h.draft.criteria = '同事能独立跑通一次'; });
    await ui.click('填写目标日期', () => { created.h.draft.targetDate = '2026-12-31'; });
    await ui.click('点击「保存」', async () => { await created.h.submit(); });
    const project = created.space.projects[0];
    const afterCreate = { opened: created.opened.slice(), editing: created.h.editing, drafts: created.h.drafts.size };

    const existing = { id: 'p1', name: '旧名', goal: '旧目标', managedBy: 'manual', nextStep: '旧下一步',
      kind: 'learning', status: 'paused', criteria: '旧标准', milestones: [{ id: 'm1', title: '阶段一', dueDate: '', done: true }], reviews: [] };
    const detail = openPanel({ project: existing });
    await ui.click('切换到里程碑分区', () => { detail.h.section = 'milestones'; });
    await ui.click('填写里程碑', () => { detail.h.draft.milestoneTitle = '  跑通构建  '; detail.h.draft.milestoneDate = '2026-11-01'; });
    await ui.click('点击「添加里程碑」', async () => { await detail.h.addMilestone(); });
    const added = detail.space.projects[0].milestones[1];
    const milestone = { id: added.id, title: added.title, done: added.done, dueDate: added.dueDate };
    await ui.click('点击里程碑完成状态', async () => { await detail.h.toggleMilestone(added); });
    const toggledOn = detail.space.projects[0].milestones[1].done;
    await ui.click('再次点击取消完成', async () => { await detail.h.toggleMilestone(detail.space.projects[0].milestones[1]); });
    const toggledOff = detail.space.projects[0].milestones[1].done;
    await ui.click('切换到复盘分区', () => { detail.h.section = 'reviews'; });
    await ui.click('填写复盘', () => { detail.h.draft.review = '  本周完成脚手架  '; });
    await ui.click('点击「添加复盘」', async () => { await detail.h.addReview(); });
    const review = detail.space.projects[0].reviews[0];
    await ui.click('暂停项目先重新推进', async () => { await detail.h.changeStatus('active'); });
    await ui.click('填写达成依据后点击「标记达成」', async () => {
      detail.h.draft.review = '演示通过，同事独立跑通一次';
      await detail.h.changeStatus('completed');
    });
    const atCompletion = detail.space.projects[0];
    const completed = { status: atCompletion.status, reviews: atCompletion.reviews.length, evidence: atCompletion.reviews[1].text };
    await ui.click('重新推进', async () => { await detail.h.changeStatus('active'); });
    const resumed = detail.space.projects[0].status;
    await ui.click('点击「暂停」', async () => { await detail.h.changeStatus('paused'); });
    await ui.click('点击「归档」', async () => { await detail.h.changeStatus('archived'); });
    const archived = detail.space.projects[0].status;
    const savesBeforeArchivedWrite = detail.saved.length;
    let archivedRejected = '';
    await ui.click('归档后再次点击「暂停」', async () => {
      try { await detail.h.changeStatus('paused'); } catch (error) { archivedRejected = error.message; }
    });

    assert.equal(project.name, '新项目', '保存应使用去空白后的名称');
    assert.equal(project.id.length > 0, true, '新建应生成稳定 ID');
    assert.equal(project.status, 'active', '新建项目默认进行中');
    assert.equal(project.kind, 'software', '应保存选择的项目类型');
    assert.equal(project.criteria, '同事能独立跑通一次', '应保存完成标准');
    assert.deepEqual(afterCreate.opened, [project.id], '新建成功后应回调进入详情');
    assert.equal(afterCreate.editing, false, '保存后应退出编辑态');
    assert.equal(afterCreate.drafts, 0, '保存后应清理进程内草稿');
    assert.equal(milestone.title, '跑通构建', '里程碑标题应去空白');
    assert.equal(milestone.done, false, '新里程碑默认未完成');
    assert.equal(milestone.dueDate, '2026-11-01', '里程碑应保存目标日期');
    assert.equal(detail.h.draft.milestoneTitle, '', '添加成功后应清空里程碑输入');
    assert.equal(toggledOn, true, '点击后里程碑应变为已完成');
    assert.equal(toggledOff, false, '再次点击应可重新打开里程碑');
    assert.equal(detail.space.projects[0].milestones[0].id, 'm1', '新增里程碑应保留既有里程碑');
    assert.equal(detail.space.projects[0].milestones[0].done, true, '新增里程碑不得重置既有完成状态');
    assert.equal(review.text, '本周完成脚手架', '复盘应保存去空白文本');
    assert.ok(review.createdAt > 0, '复盘应记录保存时间');
    assert.equal(detail.h.draft.review, '', '添加复盘后应清空输入');
    assert.equal(completed.status, 'completed', '用户确认后应转为已达成');
    assert.equal(completed.reviews, 2, '达成应追加一条「目标达成依据」复盘');
    assert.ok(completed.evidence.startsWith('目标达成依据：'), '达成复盘应带固定前缀');
    assert.ok(completed.evidence.includes('演示通过'), '达成复盘应包含用户填写的依据');
    assert.equal(detail.h.draft.review, '', '达成后应清空复盘输入框');
    assert.equal(resumed, 'active', '已达成项目应可重新推进');
    assert.equal(archived, 'archived', '应可归档项目');
    assert.equal(archivedRejected, '请先恢复已归档项目', '归档后除恢复外不得再改状态');
    assert.equal(detail.saved.length, savesBeforeArchivedWrite, '被拒绝的归档后写入不得落盘');
  });

  await test('F11', '阅读面板：快照校验、连接前置条件与身份隔离', async ui => {
    const httpLog = [];
    const routes = {};
    const h = openReading({ BusinessClient: businessClient(httpAdapter(httpLog, routes)) });
    const snapshot = readingSnapshot({
      books: [readingBook('b1', { progress: 42, entries: [readingEntry('e1')] })],
      collections: [{ id: 'c1', state: 'collected', error: '', created: 1 }],
      policy: { enabled: true, bookIds: ['b1', 'b2'], intervalHours: 12, timezone: 'Asia/Shanghai', consent: true, nextAt: 1700000000 }
    });
    await ui.click('进入阅读面板（本机已有合法快照）', () => { h.initial = snapshot; h.aboutToAppear(); });
    const shown = { books: h.books.length, progress: h.books[0].progress, bookIds: h.bookIds, interval: h.interval,
      timezone: h.timezone, enabled: h.scheduleEnabled, consent: h.consent, nextAt: h.nextAt,
      sourceConfigured: h.sourceConfigured, collections: h.collections.length };
    await ui.click('再次进入（本次没有本机快照）', () => { h.initial = undefined; h.aboutToAppear(); });
    const afterNoInitial = h.books.length;
    const invalidMessages = [];
    await ui.click('进入阅读面板（副本整体结构非法）', () => {
      try { h.show({ books: 'bad', policy: { bookIds: [] } }); } catch (error) { invalidMessages.push(error.message); }
    });
    await ui.click('进入阅读面板（单本书进度非法）', () => {
      try { h.show(readingSnapshot({ books: [readingBook('b9', { progress: 150 })] })); } catch (error) { invalidMessages.push(error.message); }
    });
    const preserved = { books: h.books.length, id: h.books[0].id, progress: h.books[0].progress };

    h.busy = true;
    await ui.click('连接处理中再次点击「连接阅读服务」', () => h.connect());
    const busyGuard = { connected: h.connected, requests: httpLog.length };
    h.busy = false;

    h.root = 'https://example.org/v1'; h.token = 'tk';
    await ui.click('根地址含 /v1 时点击连接', () => h.connect());
    const v1 = { message: h.message, requests: httpLog.length };

    h.root = 'https://example.org'; h.token = '';
    await ui.click('未填 Token 时点击连接', () => h.connect());
    const token = { message: h.message, requests: httpLog.length, connected: h.connected };

    h.root = 'http://192.168.1.9:8080'; h.token = 'tk'; h.allowHttp = false;
    await ui.click('未开启私网 HTTP 时点击连接', () => h.connect());
    const insecure = { message: h.message, requests: httpLog.length };

    h.root = 'https://example.org'; h.allowHttp = false; h.token = 'tk';
    const identity = { protocolVersion: 1, serverId: 's1', workspaceId: 'w1' };
    routes['/eye/v1/capabilities'] = { responseCode: 200, result: JSON.stringify({ ...identity, protocolVersion: 2 }) };
    await ui.click('服务协议版本不符时点击连接', () => h.connect());
    const protocol = h.message;
    routes['/eye/v1/capabilities'] = { responseCode: 200, result: JSON.stringify({ ...identity, serverId: '' }) };
    await ui.click('服务缺少 serverId 时点击连接', () => h.connect());
    const server = h.message;
    routes['/eye/v1/capabilities'] = { responseCode: 200, result: JSON.stringify({ ...identity, workspaceId: '' }) };
    await ui.click('服务缺少 workspaceId 时点击连接', () => h.connect());
    const workspace = h.message;

    routes['/eye/v1/capabilities'] = { responseCode: 200, result: JSON.stringify(identity) };
    routes['/eye/v1/reading'] = { responseCode: 200, result: JSON.stringify(readingSnapshot({ books: [readingBook('b2', { progress: 7 })] })) };
    await ui.click('尚未绑定服务时点击连接', () => h.connect());
    const unbound = { connected: h.connected, id: h.books[0].id, token: h.token, message: h.message };

    h.serverId = 's1'; h.workspaceId = 'w1'; h.token = 'tk'; h.connected = false;
    routes['/eye/v1/capabilities'] = { responseCode: 200, result: JSON.stringify({ ...identity, serverId: 's2' }) };
    await ui.click('已绑定服务身份变化时点击连接', () => h.connect());
    const mismatch = { message: h.message, connected: h.connected, books: h.books.length, id: h.books[0].id };

    h.token = 'tk';
    routes['/eye/v1/capabilities'] = { responseCode: 200, result: JSON.stringify(identity) };
    const boundBefore = httpLog.length;
    await ui.click('身份一致后点击连接', () => h.connect());
    const bound = { connected: h.connected, token: h.token, id: h.books[0].id, message: h.message,
      requests: httpLog.slice(boundBefore).filter((item) => item.includes('/eye/v1/')).map((item) => item.replace('https://example.org', '')) };

    h.token = 'tk'; h.connected = false;
    routes['/eye/v1/reading'] = { responseCode: 200, result: JSON.stringify({ books: [], policy: null }) };
    await ui.click('服务返回非法阅读副本时点击连接', () => h.connect());
    const badCopy = { message: h.message, connected: h.connected, id: h.books[0].id };
    h.token = 'tk';
    routes['/eye/v1/reading'] = { responseCode: 503, result: '' };
    await ui.click('服务不可用时点击连接', () => h.connect());
    const offline = { message: h.message, connected: h.connected, id: h.books[0].id };
    h.client = undefined; h.identity = undefined;
    let refreshMessage = '';
    await ui.click('未连接时点击「刷新阅读副本」', async () => {
      try { await h.refresh(); } catch (error) { refreshMessage = error.message; }
    });

    assert.equal(shown.books, 1, '合法快照应写入书籍列表');
    assert.equal(shown.progress, 42, '合法快照应保留来源进度百分数');
    assert.equal(shown.bookIds, 'b1,b2', '合法快照应把授权范围回显为逗号分隔文本');
    assert.equal(shown.interval, '12', '合法快照应回显周期小时数');
    assert.equal(shown.timezone, 'Asia/Shanghai', '合法快照应回显时区');
    assert.equal(shown.enabled, true, '合法快照应回显周期已启用');
    assert.equal(shown.consent, true, '合法快照应回显分享同意状态');
    assert.equal(shown.nextAt, 1700000000, '合法快照应回显下次周期检查时间');
    assert.equal(shown.sourceConfigured, true, '合法快照应回显来源已配置');
    assert.equal(shown.collections, 1, '合法快照应回显采集批次');
    assert.equal(afterNoInitial, 1, '没有初始快照时进入面板不应清空既有书籍');
    assert.equal(invalidMessages.length, 2, '两种非法快照都应被拒绝');
    assert.match(invalidMessages[0], /阅读副本无效/, '结构非法应给出中文副本错误');
    assert.match(invalidMessages[1], /阅读来源无效/, '单本书字段非法应给出中文来源错误');
    assert.equal(preserved.books, 1, '非法快照抛错后不得清空已有书籍');
    assert.equal(preserved.id, 'b1', '非法快照抛错后原书应保持不变');
    assert.equal(preserved.progress, 42, '非法快照抛错后原进度应保持不变');
    assert.equal(busyGuard.connected, false, '连接处理中重复点击不得改变连接状态');
    assert.equal(busyGuard.requests, 0, '连接处理中重复点击不得发起任何请求');
    assert.match(v1.message, /不含 \/v1/, '根地址含 /v1 应给出中文提示');
    assert.equal(v1.requests, 0, '根地址非法时不得触达网络');
    assert.match(token.message, /凭据/, '缺少 Token 应提示配置独立业务凭据');
    assert.equal(token.requests, 0, '缺少 Token 时不得触达网络');
    assert.equal(token.connected, false, '缺少 Token 时不得标记为已连接');
    assert.match(insecure.message, /HTTPS/, '未开启开关的私网 HTTP 应被拒绝');
    assert.equal(insecure.requests, 0, '私网 HTTP 未开启时不得触达网络');
    assert.match(protocol, /身份/, '协议版本不符应给出身份错误');
    assert.match(server, /身份/, '缺少 serverId 应给出身份错误');
    assert.match(workspace, /身份/, '缺少 workspaceId 应给出身份错误');
    assert.equal(unbound.connected, true, '尚未绑定服务时身份一致应连接成功');
    assert.equal(unbound.id, 'b2', '连接成功应读取并展示服务端书籍');
    assert.equal(unbound.token, '', '连接成功后应清空内存中的 Token');
    assert.match(unbound.message, /已读取业务服务的阅读副本/, '连接成功应提示需要配置范围与授权');
    assert.match(mismatch.message, /身份/, '已绑定服务的身份变化应明确失败');
    assert.equal(mismatch.connected, false, '身份不一致时不得标记为已连接');
    assert.equal(mismatch.books, 1, '身份不一致时不得清空本机书籍');
    assert.equal(mismatch.id, 'b2', '身份不一致时不得覆盖本机副本');
    assert.equal(bound.connected, true, '身份一致时应连接成功');
    assert.equal(bound.token, '', '连接成功应清空 Token');
    assert.equal(bound.id, 'b2', '连接成功应读取副本');
    assert.deepEqual(bound.requests, ['/eye/v1/capabilities', '/eye/v1/reading'], '连接应只请求身份与阅读副本');
    assert.match(badCopy.message, /阅读副本无效/, '服务端返回非法副本应给出中文错误');
    assert.equal(badCopy.connected, false, '非法副本不得标记为已连接');
    assert.equal(badCopy.id, 'b2', '非法副本不得覆盖上一次可用副本');
    assert.match(offline.message, /业务请求未确认/, '网络失败应给出可读中文错误');
    assert.equal(offline.connected, false, '网络失败不得标记为已连接');
    assert.equal(offline.id, 'b2', '网络失败不得清空上次可用副本');
    assert.match(refreshMessage, /先连接/, '未连接刷新应提示先连接独立业务服务');
  });

  await test('F12', '阅读周期与提问：可见范围授权、周期边界与失败保留输入', async ui => {
    const requests = [];
    let receipt = 'ok';
    class Client {
      async reading() {
        return { books: [], policy: { enabled: false, bookIds: [], intervalHours: 24, timezone: 'Asia/Shanghai', consent: false },
          sourceConfigured: true };
      }
      async readingPolicy(policy) { requests.push(['policy', policy]); return policy; }
      async collectReading(request) { requests.push(['collect', request]); return { books: [], policy: {}, sourceConfigured: true }; }
      async readingQuestion(request) { requests.push(['question', request]); return receipt === 'none' ? undefined : request; }
      async readingAnswer(request) {
        requests.push(['answer', request]);
        if (receipt === 'fail') { throw new Error('回答未确认，请查询原操作'); }
        return { id: request.operationId, state: 'completed' };
      }
    }
    const h = openReading({ BusinessClient: Client });
    const client = new Client();
    h.client = client; h.identity = { protocolVersion: 1, serverId: 's1', workspaceId: 'w1' };
    await ui.click('未连接时点击「一键采集/整理」', () => { h.client = undefined; return h.act(c => h.collect(c)); });
    const noClient = { requests: requests.length, message: h.message };
    h.client = client; h.busy = true;
    await ui.click('处理中再次点击「一键采集/整理」', () => h.act(c => h.collect(c)));
    const busy = requests.length;
    h.busy = false;
    h.bookIds = 'b1, b2 ,'; h.interval = '12'; h.timezone = ' Asia/Shanghai '; h.consent = true; h.scheduleEnabled = true;
    await ui.click('保存可见范围与周期', () => h.act(c => h.savePolicy(c)));
    const policy = JSON.parse(JSON.stringify(requests[0][1]));
    h.bookIds = 'b9'; h.interval = '720';
    await ui.click('确认当前范围后点击「一键采集/整理」', () => h.act(c => h.collect(c)));
    const collect = { order: requests.slice(1).map((item) => item[0]).join(','),
      policy: JSON.parse(JSON.stringify(requests[1][1])), cycle: requests[2][1].cycleId, message: h.message };

    h.consent = false; h.scheduleEnabled = false;
    const beforeUnconsented = requests.length;
    await ui.click('未勾选同意时点击「一键采集/整理」', () => h.act(c => h.collect(c)));
    const unconsented = { requests: requests.length - beforeUnconsented,
      policy: JSON.parse(JSON.stringify(requests[requests.length - 2][1])), message: h.message };

    const bounds = [];
    for (const value of ['0', '1', '720', '721', 'abc']) {
      h.interval = value;
      await ui.click('周期输入「' + value + '」后保存', () => h.act(c => h.savePolicy(c)));
      bounds.push(requests[requests.length - 1][1].intervalHours);
    }

    const questions = () => requests.filter((item) => item[0] === 'question').length;
    h.selectedBook = ''; h.selectedEntry = ''; h.questionText = 'X'; h.quote = '片段';
    await ui.click('未选择来源笔记时点击「提问」', () => h.act(c => h.ask(c)));
    const missing = { message: h.message, questions: questions() };
    h.selectedBook = 'b1'; h.selectedEntry = 'e1'; h.questionText = ''; h.quote = '片段';
    await ui.click('未填写疑问内容时点击「提问」', () => h.act(c => h.ask(c)));
    const emptyText = { message: h.message, questions: questions() };
    h.questionText = 'x'.repeat(1001);
    await ui.click('疑问超过 1000 字时点击「提问」', () => h.act(c => h.ask(c)));
    const longText = { message: h.message, questions: questions() };
    h.questionText = '为什么？'; h.quote = '';
    await ui.click('未确认连续原文片段时点击「提问」', () => h.act(c => h.ask(c)));
    const noQuote = { message: h.message, questions: questions() };
    h.quote = 'x'.repeat(1501);
    await ui.click('原文片段超过 1500 字时点击「提问」', () => h.act(c => h.ask(c)));
    const longQuote = { message: h.message, questions: questions() };
    h.quote = '连续原文片段';
    await ui.click('确认片段并点击「提问」', () => h.act(c => h.ask(c)));
    const asked = { questions: questions(), text: h.questionText,
      question: requests[requests.length - 2][1], answer: requests[requests.length - 1][1], message: h.message };
    await ui.click('成功提问后立即再次点击「提问」', () => h.act(c => h.ask(c)));
    const resubmit = { questions: questions(), text: h.questionText, message: h.message };

    receipt = 'none';
    const answersBefore = requests.filter((item) => item[0] === 'answer').length;
    h.questionText = '没有回执的疑问';
    await ui.click('提问没有回执时点击「提问」', () => h.act(c => h.ask(c)));
    const noReceipt = { text: h.questionText, message: h.message,
      answers: requests.filter((item) => item[0] === 'answer').length - answersBefore };
    receipt = 'fail';
    h.questionText = '会失败的疑问';
    await ui.click('回答未确认时点击「提问」', () => h.act(c => h.ask(c)));
    const answerFailed = { text: h.questionText, message: h.message };

    assert.equal(noClient.requests, 0, '未连接时点击采集不得发起任何请求');
    assert.equal(busy, 0, '处理中重复点击采集不得发起任何请求');
    assert.deepEqual(policy, { enabled: true, bookIds: ['b1', 'b2'], intervalHours: 12, timezone: 'Asia/Shanghai', consent: true },
      '保存范围应去空白、丢弃空 ID 并携带周期与同意');
    assert.equal(collect.order, 'policy,collect', '采集必须先保存当前可见范围再请求采集');
    assert.deepEqual(collect.policy.bookIds, ['b9'], '采集应使用当前可见范围而不是旧设置');
    assert.equal(typeof collect.cycle, 'string', '采集请求应携带批次 ID');
    assert.ok(collect.cycle.length > 0, '采集批次 ID 不应为空');
    assert.match(collect.message, /已读取并保存实际结果/, '成功后应提示已保存实际结果');
    assert.equal(unconsented.requests, 2, '未勾选同意时客户端仍会提交范围并请求采集');
    assert.equal(unconsented.policy.consent, false, '未勾选同意时上报的同意状态应为 false');
    assert.match(unconsented.message, /已读取并保存实际结果/, '客户端未按同意状态拦截，同意校验由业务服务端完成');
    assert.deepEqual(bounds, [0, 1, 720, 721, NaN], '客户端按原样转发周期数值，1–720 边界由业务服务校验');
    assert.match(missing.message, /选择来源笔记/, '未选来源应提示选择来源笔记');
    assert.equal(missing.questions, 0, '未选来源不得提交问题');
    assert.match(emptyText.message, /选择来源笔记/, '空疑问应提示填写 1–1000 字');
    assert.equal(emptyText.questions, 0, '空疑问不得提交问题');
    assert.match(longText.message, /选择来源笔记/, '疑问超过 1000 字应被拒绝');
    assert.equal(longText.questions, 0, '超长疑问不得提交问题');
    assert.match(noQuote.message, /原始来源片段/, '未确认片段应提示 1–1500 字连续原文');
    assert.equal(noQuote.questions, 0, '未确认片段不得提交问题');
    assert.match(longQuote.message, /原始来源片段/, '片段超过 1500 字应被拒绝');
    assert.equal(longQuote.questions, 0, '超长片段不得提交问题');
    assert.equal(asked.questions, 1, '合法提问应恰好提交一个问题');
    assert.equal(asked.question.bookId, 'b1', '问题应记录所选书籍');
    assert.equal(asked.question.entryId, 'e1', '问题应记录所选条目');
    assert.equal(asked.question.quote, '连续原文片段', '问题应记录用户确认的连续原文片段');
    assert.equal(asked.answer.questionId, asked.question.id, '回答必须沿用刚创建的问题 ID');
    assert.equal(asked.answer.input, '为什么？', '回答输入应为用户填写的疑问正文');
    assert.equal(asked.text, '', '提问成功后应清空输入框');
    assert.match(asked.message, /已读取并保存实际结果/, '提问成功应提示已保存实际结果');
    assert.equal(resubmit.questions, 1, '同一问题在输入被清空后不得重复提交');
    assert.equal(resubmit.text, '', '重复点击后输入仍应为空');
    assert.equal(noReceipt.answers, 0, '没有回执时不得伪造一次回答提交');
    assert.equal(noReceipt.text, '没有回执的疑问', '没有回执应保留疑问输入以便重试');
    assert.doesNotMatch(noReceipt.message, /已读取并保存实际结果/, '没有回执不得显示成功提示');
    assert.match(answerFailed.message, /回答未确认/, '回答失败应回显服务错误');
    assert.equal(answerFailed.text, '会失败的疑问', '回答失败应保留输入');
  });

  await test('F13', '业务面板：本机副本读取、连接前置与身份隔离', async ui => {
    const httpLog = [];
    let identityRoute = { responseCode: 200, result: JSON.stringify({ protocolVersion: 1, serverId: 's1', workspaceId: 'w1' }) };
    const kit = { http: { RequestMethod: { GET: 'GET', POST: 'POST' }, HttpDataType: { STRING: 'string' },
      createHttp: () => ({
        async request(url) {
          httpLog.push(url);
          if (url.endsWith('/capabilities')) { return identityRoute; }
          throw new Error('未预期请求 ' + url);
        },
        destroy() { httpLog.push('destroy'); }
      }) } };
    const Client = businessClient(kit);
    let existingState;
    let loadState;
    let existingError;
    const coordinators = [];
    class Repository {
      async existing() { if (existingError) { throw existingError; } return existingState; }
      async load(_context, initial) { return loadState || initial; }
      async save() {}
    }
    class Coordinator {
      constructor(state, repository, client) { this.state = state; this.repository = repository; this.client = client; coordinators.push(this); }
      current() { return this.state; }
    }
    const h = businessPanelA({ dayKey: w.dayKey, newId: w.newId, projectBrief: w.projectBrief,
      newBusinessState: businessSync.newBusinessState, assertBusinessIdentity: businessSync.assertBusinessIdentity,
      BusinessClient: Client, BusinessRepository: Repository, BusinessCoordinator: Coordinator });
    Object.assign(h, businessPanelFields());

    await ui.click('进入业务面板（本机无副本）', async () => { h.aboutToAppear(); await tick(); });
    const noReplica = { localReady: h.localReady, coordinators: coordinators.length };
    const project = { id: 'p1', name: '学 ArkTS', goal: '掌握状态管理', managedBy: 'manual', nextStep: '读文档' };
    h.project = project; existingState = undefined;
    await ui.click('从项目进入业务面板', async () => { h.aboutToAppear(); await tick(); });
    const projectEntry = { needId: h.needId, prompt: h.prompt };

    existingState = businessSync.newBusinessState({ protocolVersion: 1, serverId: 's9', workspaceId: 'w9' }, 'd9');
    await ui.click('重新进入（本机已有业务副本）', async () => { h.loadOffline(); await tick(); });
    const loaded = { localReady: h.localReady, serverId: h.replica.serverId, coordinators: coordinators.length, status: h.status, busy: h.busy };
    existingError = new Error('业务副本损坏，禁止覆盖'); h.localReady = false;
    await ui.click('本机副本损坏时进入', async () => { h.loadOffline(); await tick(); });
    const broken = { status: h.status, busy: h.busy, localReady: h.localReady, serverId: h.replica.serverId };
    existingError = undefined;

    h.busy = true;
    await ui.click('处理中再次点击「连接独立业务服务」', () => h.connect());
    const busyGuard = httpLog.length;
    h.busy = false;
    h.root = 'https://example.org/v1'; h.token = 'tk';
    await ui.click('根地址含 /v1 时点击连接', () => h.connect());
    const v1 = { status: h.status, requests: httpLog.length };
    h.root = 'https://example.org'; h.token = '';
    await ui.click('未填 Token 时点击连接', () => h.connect());
    const token = { status: h.status, requests: httpLog.length, connected: h.connected };
    h.root = 'http://192.168.1.9:8080'; h.token = 'tk'; h.allowHttp = false;
    await ui.click('未开启私网 HTTP 时点击连接', () => h.connect());
    const insecure = { status: h.status, requests: httpLog.length };

    const beforeMismatch = h.replica;
    const coordinatorsBefore = coordinators.length;
    loadState = businessSync.newBusinessState({ protocolVersion: 1, serverId: 'other', workspaceId: 'w1' }, 'd1');
    h.root = 'https://example.org'; h.allowHttp = false; h.token = 'tk';
    await ui.click('服务身份与本机副本不一致时点击连接', () => h.connect());
    const mismatch = { status: h.status, connected: h.connected, sameReplica: h.replica === beforeMismatch, coordinators: coordinators.length };

    loadState = undefined;
    await ui.click('身份一致时点击连接', () => h.connect());
    const bound = { connected: h.connected, localReady: h.localReady, token: h.token, status: h.status,
      serverId: h.replica.serverId, workspaceId: h.replica.workspaceId };

    const acts = [];
    h.coordinator = undefined; h.busy = false;
    await ui.click('未连接时点击「同步业务副本」', () => h.act(async () => { acts.push('不应执行'); }));
    const noCoordinator = acts.length;
    h.busy = true;
    await ui.click('处理中重复点击「同步业务副本」', () => h.act(async () => { acts.push('不应执行'); }));
    const busyAct = acts.length;
    h.busy = false;
    h.coordinator = { current: () => h.replica, edit: async () => {} };
    await ui.click('点击「同步业务副本」', () => h.act(async () => { acts.push('同步'); }));
    const actDone = { acts: acts.join(','), status: h.status, busy: h.busy };
    await ui.click('同步服务未推进时点击「同步业务副本」', () => h.act(async () => { throw new Error('业务服务同步未推进'); }));
    const actFailed = { status: h.status, busy: h.busy };

    assert.equal(noReplica.localReady, false, '本机没有副本时不应标记为可离线使用');
    assert.equal(noReplica.coordinators, 0, '本机没有副本时不应创建协调器');
    assert.equal(projectEntry.needId, 'project-p1', '从项目进入应绑定稳定的项目会话标识');
    assert.equal(projectEntry.prompt, w.projectBrief(project), '从项目进入应预填可编辑的项目摘要');
    assert.equal(loaded.localReady, true, '读取到本机副本后应可离线使用');
    assert.equal(loaded.serverId, 's9', '应读取本机副本的服务身份');
    assert.equal(loaded.coordinators, 1, '读取到本机副本后应建立协调器');
    assert.match(loaded.status, /已读取本机业务副本/, '读取成功应说明可离线新增计划');
    assert.equal(loaded.busy, false, '读取结束应复位忙碌状态');
    assert.match(broken.status, /业务副本损坏/, '副本读取失败应就地显示中文错误');
    assert.equal(broken.busy, false, '副本读取失败也应复位忙碌状态');
    assert.equal(broken.localReady, false, '副本读取失败不得标记为可用');
    assert.equal(broken.serverId, 's9', '副本读取失败不得清空已加载的本机副本');
    assert.equal(busyGuard, 0, '连接处理中重复点击不得触达网络');
    assert.match(v1.status, /不含 \/v1/, '根地址含 /v1 应给出中文提示');
    assert.equal(v1.requests, 0, '根地址非法时不得触达网络');
    assert.match(token.status, /凭据/, '缺少 Token 应提示配置独立业务凭据');
    assert.equal(token.requests, 0, '缺少 Token 时不得触达网络');
    assert.equal(token.connected, false, '缺少 Token 时不得标记为已连接');
    assert.match(insecure.status, /HTTPS/, '未开启开关的私网 HTTP 应被拒绝');
    assert.equal(insecure.requests, 0, '私网 HTTP 未开启时不得触达网络');
    assert.match(mismatch.status, /身份已变化/, '身份不一致应显式失败');
    assert.equal(mismatch.connected, false, '身份不一致时不得标记为已连接');
    assert.equal(mismatch.sameReplica, true, '身份不一致时不得用新副本覆盖本机副本');
    assert.equal(mismatch.coordinators, coordinatorsBefore, '身份不一致时不得建立绑定协调器');
    assert.equal(bound.connected, true, '身份一致时应绑定成功');
    assert.equal(bound.localReady, true, '绑定成功后应可离线使用');
    assert.equal(bound.token, '', '绑定成功后应清空内存 Token');
    assert.equal(bound.serverId, 's1', '绑定后副本应记录服务身份');
    assert.equal(bound.workspaceId, 'w1', '绑定后副本应记录业务空间');
    assert.match(bound.status, /已绑定业务空间/, '绑定成功应说明只有点击同步才会上传');
    assert.equal(noCoordinator, 0, '未连接时点击同步不得执行任何动作');
    assert.equal(busyAct, 0, '处理中重复点击同步不得执行任何动作');
    assert.equal(actDone.acts, '同步', '已连接时点击同步应执行一次动作');
    assert.match(actDone.status, /本次操作已保存/, '同步成功应提示以列表状态为准');
    assert.equal(actDone.busy, false, '动作结束应复位忙碌状态');
    assert.match(actFailed.status, /业务服务同步未推进/, '同步失败应回显服务错误');
    assert.equal(actFailed.busy, false, '同步失败也应复位忙碌状态');
  });

  await test('F14', '业务面板：新增计划、墓碑删除与发送输入边界', async ui => {
    const globals = { dayKey: w.dayKey, newId: w.newId, projectBrief: w.projectBrief,
      newBusinessState: businessSync.newBusinessState, assertBusinessIdentity: businessSync.assertBusinessIdentity };
    const a = businessPanelA(globals);
    Object.assign(a, businessPanelFields());
    const Coordinator = load('services/BusinessCoordinator.ets', { '../core/BusinessSync': businessSync }).BusinessCoordinator;
    const persisted = [];
    const state = businessSync.newBusinessState({ protocolVersion: 1, serverId: 's1', workspaceId: 'w1' }, 'd1');
    a.coordinator = new Coordinator(state, { save: async (next) => { persisted.push(next); } }, {});
    a.replica = a.coordinator.current();
    await ui.click('空标题点击「保存到待同步列表」', () => a.act(c => a.createPlan(c)));
    const blank = { outbox: a.replica.outbox.length, persisted: persisted.length, status: a.status, title: a.title };
    a.title = 'x'.repeat(201);
    await ui.click('标题超过 200 字点击「保存到待同步列表」', () => a.act(c => a.createPlan(c)));
    const longTitle = { outbox: a.replica.outbox.length, status: a.status };
    a.title = '  读书计划  ';
    await ui.click('填写今日计划后点击「保存到待同步列表」', () => a.act(c => a.createPlan(c)));
    const created = { outbox: a.replica.outbox.length, persisted: persisted.length,
      mutation: JSON.parse(JSON.stringify(a.replica.outbox[0])), title: a.title, status: a.status };

    const b = businessPanelB({ newId: w.newId });
    Object.assign(b, businessPanelFields());
    const tombstones = [];
    b.replica = businessSync.newBusinessState({ protocolVersion: 1, serverId: 's1', workspaceId: 'w1' }, 'd1');
    b.replica.entities.push({ kind: 'plan', id: 'plan-1', revision: 3, deleted: false, payload: { title: '旧计划' }, origin: 'local' });
    b.coordinator = { edit: async (mutation) => { tombstones.push(mutation); }, current: () => b.replica };
    const entity = b.replica.entities[0];
    await ui.click('点击「删除此计划」', async () => { await b.deletePlan(b.coordinator, entity); });
    const deleted = { mutation: JSON.parse(JSON.stringify(tombstones[0])), entities: b.replica.entities.length,
      live: b.replica.entities.filter((item) => !item.deleted).length };

    const writes = [];
    b.project = { id: 'p2', name: '新项目', goal: '目标', managedBy: 'manual', nextStep: '' };
    b.replica = businessSync.newBusinessState({ protocolVersion: 1, serverId: 's1', workspaceId: 'w1' }, 'd1');
    b.coordinator = { edit: async (mutation) => { writes.push(mutation); }, current: () => b.replica };
    await ui.click('确认将当前项目加入待同步列表（本机尚无确认版本）', async () => { await b.exportProject(b.coordinator); });
    const exported = { baseRevision: writes[0].baseRevision, kind: writes[0].kind, name: writes[0].payload.name };

    b.needId = 'stable-id'; b.prompt = '   ';
    await ui.click('消息为空点击「保存意图并发送」', async () => {
      await assert.rejects(() => b.send(b.coordinator), /1–4000 字/);
    });
    b.prompt = 'x'.repeat(4001);
    await ui.click('消息超过 4000 字点击「保存意图并发送」', async () => {
      await assert.rejects(() => b.send(b.coordinator), /1–4000 字/);
    });

    assert.equal(blank.outbox, 0, '空标题不得加入待同步列表');
    assert.equal(blank.persisted, 0, '空标题不得写入本机副本');
    assert.match(blank.status, /计划标题请输入 1–200 字/, '空标题应给出中文校验提示');
    assert.equal(longTitle.outbox, 0, '超长标题不得加入待同步列表');
    assert.match(longTitle.status, /计划标题请输入 1–200 字/, '超长标题应给出中文校验提示');
    assert.equal(created.outbox, 1, '合法计划应恰好进入一次待同步列表');
    assert.equal(created.persisted, 1, '合法计划应恰好持久化一次本机副本');
    assert.equal(created.mutation.kind, 'plan', '新增计划应写入 plan 类型变更');
    assert.equal(created.mutation.deleted, false, '新增计划不应标记为删除');
    assert.equal(created.mutation.baseRevision, 0, '新增计划的修改基线应为 0');
    assert.equal(created.mutation.deviceId, 'd1', '变更应携带本机设备标识');
    assert.equal(created.mutation.payload.title, '读书计划', '计划标题应去除首尾空白');
    assert.equal(created.mutation.payload.date, w.dayKey(new Date()), '计划日期应为今天');
    assert.equal(created.mutation.payload.status, 'todo', '新增计划状态应为待完成');
    assert.equal(created.title, '', '加入待同步列表后应清空输入');
    assert.match(created.status, /本次操作已保存/, '新增成功应提示同步状态以列表为准');
    assert.equal(deleted.mutation.deleted, true, '「删除此计划」应写入墓碑而不是物理删除');
    assert.equal(deleted.mutation.kind, 'plan', '墓碑应保留对象类型');
    assert.equal(deleted.mutation.id, 'plan-1', '墓碑应指向被删除的计划');
    assert.equal(deleted.mutation.baseRevision, 3, '墓碑应携带原确认版本作为基线');
    assert.deepEqual(deleted.mutation.payload, {}, '墓碑不应携带业务字段');
    assert.equal(deleted.entities, 1, '点击删除不得物理移除本机副本中的对象');
    assert.equal(deleted.live, 1, '墓碑写入期间本机对象仍在列表中，等待同步确认');
    assert.equal(exported.baseRevision, 0, '本机尚无确认版本时项目变更基线应为 0');
    assert.equal(exported.kind, 'project', '项目导出应写入 project 类型变更');
    assert.equal(exported.name, '新项目', '项目导出应携带项目名称');
  });

  await test('F15', '项目面板：可写状态、草稿键隔离与草稿复用', async ui => {
    const base = { id: 'p1', name: '旧名', goal: '旧目标', managedBy: 'manual', nextStep: '', kind: 'learning',
      status: 'active', criteria: '旧标准', milestones: [], reviews: [] };
    const active = openPanel({ project: base, server: 'server-a' });
    const archived = openPanel({ project: { ...base, status: 'archived' }, server: 'server-a' });
    const readonly = openPanel({ project: base, server: 'server-a', writable: false });
    const fresh = openPanel({ server: 'server-a' });
    const otherServer = openPanel({ project: base, server: 'server-b' });
    const canEdit = { active: active.h.canEdit(), archived: archived.h.canEdit(), readonly: readonly.h.canEdit(), fresh: fresh.h.canEdit() };
    const keys = { active: active.h.draftKey(), other: otherServer.h.draftKey(), fresh: fresh.h.draftKey() };

    const shared = new Map();
    const first = openPanel({ project: base, server: 'server-a', drafts: shared });
    await ui.click('第一次打开项目详情', () => { first.h.aboutToAppear(); });
    const firstOpen = { name: first.h.draft.name, editing: first.h.editing, drafts: shared.size };
    await ui.click('改名后返回（保留草稿）', () => { first.h.draft.name = '未保存的新名'; first.h.remember(); });
    const remembered = shared.get('server-a/project/p1').name;
    const second = openPanel({ project: base, server: 'server-a', drafts: shared });
    await ui.click('再次打开同一项目', () => { second.h.aboutToAppear(); });
    const reopened = { name: second.h.draft.name, stored: second.space.projects[0].name, editing: second.h.editing };
    const other = openPanel({ project: base, server: 'server-b', drafts: shared });
    await ui.click('切换到另一台服务器打开同一项目', () => { other.h.aboutToAppear(); });
    const isolated = { name: other.h.draft.name, key: other.h.draftKey() };
    const newDraft = openPanel({ server: 'server-a', drafts: shared });
    await ui.click('打开新建项目表单', () => { newDraft.h.aboutToAppear(); });
    const created = { name: newDraft.h.draft.name, editing: newDraft.h.editing, key: newDraft.h.draftKey() };

    const failing = openPanel({ server: 'server-a' });
    failing.h.draft.name = '待保存的项目';
    let saveCalls = 0;
    failing.h.save = async () => { saveCalls++; return false; };
    await ui.click('保存项目（本机写入失败）', async () => { await failing.h.submit(); });
    const failed = { saveCalls: saveCalls, opened: failing.opened.length, editing: failing.h.editing, drafts: failing.h.drafts.size };

    const existing = openPanel({ project: base, server: 'server-a' });
    await ui.click('编辑已有项目名称并保存', async () => { existing.h.draft.name = '新名字'; await existing.h.submit(); });
    const saved = { opened: existing.opened.length, editing: existing.h.editing, name: existing.space.projects[0].name,
      drafts: existing.h.drafts.size, saves: existing.saved.length };

    const empty = openPanel();
    const emptySaves = empty.saved.length;
    await ui.click('无项目时点击状态、里程碑与复盘', async () => {
      await empty.h.changeStatus('paused'); await empty.h.addMilestone(); await empty.h.addReview();
      await empty.h.toggleMilestone({ id: 'm1', title: 'x', dueDate: '', done: false });
    });
    const guarded = { saves: empty.saved.length - emptySaves, editing: empty.h.editing };

    const done = openPanel({ project: { ...base }, server: 'server-a' });
    await ui.click('填写达成依据并标记达成', async () => { done.h.draft.review = '演示通过'; await done.h.changeStatus('completed'); });
    const completed = { status: done.space.projects[0].status, review: done.h.draft.review,
      remembered: done.h.drafts.get('server-a/project/p1').review };

    assert.equal(canEdit.active, true, '可写且进行中的项目应允许编辑');
    assert.equal(canEdit.archived, false, '已归档项目不应允许编辑');
    assert.equal(canEdit.readonly, false, '只读进入的项目不应允许编辑');
    assert.equal(canEdit.fresh, true, '新建项目表单应允许保存');
    assert.equal(keys.active, 'server-a/project/p1', '草稿键应包含服务器与项目 ID');
    assert.equal(keys.other, 'server-b/project/p1', '切换服务器应得到不同的草稿键');
    assert.equal(keys.fresh, 'server-a/project/new', '新建项目应使用独立的草稿键');
    assert.equal(firstOpen.name, '旧名', '首次打开应以正式项目初始化草稿');
    assert.equal(firstOpen.editing, false, '打开已有项目不应直接进入编辑态');
    assert.equal(firstOpen.drafts, 0, '首次打开不应产生新草稿');
    assert.equal(remembered, '未保存的新名', '返回时应按草稿键保留未保存修改');
    assert.equal(reopened.name, '未保存的新名', '再次打开同一项目应复用保留的草稿');
    assert.equal(reopened.stored, '旧名', '复用草稿不得改写本机正式数据');
    assert.equal(isolated.name, '旧名', '切换服务器后不得串用另一台服务器的草稿');
    assert.equal(isolated.key, 'server-b/project/p1', '切换服务器后草稿键应随之变化');
    assert.equal(created.editing, true, '新建项目表单应处于编辑态');
    assert.equal(created.name, '', '新建项目草稿应为空而不是复用已有项目草稿');
    assert.equal(created.key, 'server-a/project/new', '新建项目草稿键不应与他人冲突');
    assert.equal(failed.saveCalls, 1, '保存失败仍应尝试一次本机写入');
    assert.equal(failed.opened, 0, '保存失败不得进入新建项目详情');
    assert.equal(failed.editing, true, '保存失败应停留在编辑态保留输入');
    assert.equal(failed.drafts, 0, '保存失败不得清理或新增草稿');
    assert.equal(saved.opened, 0, '保存已有项目不应回调新建入口');
    assert.equal(saved.editing, false, '保存成功后应退出编辑态');
    assert.equal(saved.name, '新名字', '保存应把草稿写入正式项目');
    assert.equal(saved.drafts, 0, '保存成功后应清理对应草稿');
    assert.equal(saved.saves, 1, '保存成功应恰好写入一次本机');
    assert.equal(guarded.saves, 0, '没有项目时状态、里程碑与复盘操作不得写入本机');
    assert.equal(guarded.editing, true, '无项目面板应保持新建编辑态');
    assert.equal(completed.status, 'completed', '标记达成应转为已达成');
    assert.equal(completed.review, '', '标记达成后应清空达成依据输入');
    assert.equal(completed.remembered, '', '标记达成后应把已清空的依据写回草稿');
  });

  await test('F16', '业务面板：同步失败保留待确认编辑并支持重建副本', async ui => {
    const Coordinator = load('services/BusinessCoordinator.ets', { '../core/BusinessSync': businessSync }).BusinessCoordinator;
    const state = businessSync.newBusinessState({ protocolVersion: 1, serverId: 's1', workspaceId: 'w1' }, 'd1');
    businessSync.enqueueBusinessMutation(state, { deviceId: 'd1', mutationId: 'm1', kind: 'plan', id: 'plan-1',
      baseRevision: 0, deleted: false, payload: { title: '待同步计划' } });
    let mode = 'fail';
    const calls = [];
    const saved = [];
    const transport = {
      async identity() { return { protocolVersion: 1, serverId: 's1', workspaceId: 'w1' }; },
      async mutate(mutation) {
        calls.push('mutate:' + mutation.mutationId);
        if (mode === 'fail') { throw new Error('业务服务同步未推进，请保留待确认编辑'); }
        return { status: 'accepted', entity: { kind: mutation.kind, id: mutation.id, revision: 1, deleted: false,
          payload: mutation.payload, origin: 'remote' } };
      },
      async pull(cursor) { calls.push('pull:' + cursor); return { entities: [], cursor: cursor, hasMore: false }; },
      async snapshot() { calls.push('snapshot'); return { entities: [], cursor: 9, hasMore: false }; }
    };
    const coordinator = new Coordinator(state, { save: async (next) => { saved.push(next); } }, transport);
    const h = businessPanelA({ dayKey: w.dayKey, newId: w.newId, projectBrief: w.projectBrief,
      newBusinessState: businessSync.newBusinessState, assertBusinessIdentity: businessSync.assertBusinessIdentity });
    Object.assign(h, businessPanelFields({ coordinator: coordinator, replica: coordinator.current(),
      localReady: true, connected: true }));

    await ui.click('已连接后点击「同步业务副本」（服务未推进）', () => h.act(c => c.synchronize()));
    const failed = { status: h.status, outbox: h.replica.outbox.length, saved: saved.length, calls: calls.join(',') };

    mode = 'ok';
    await ui.click('服务恢复后再次点击「同步业务副本」', () => h.act(c => c.synchronize()));
    const synced = { outbox: h.replica.outbox.length, cursor: h.replica.cursor, status: h.status,
      entity: h.replica.entities[0].payload.title };

    await ui.click('点击「重建已确认副本（保留待确认编辑）」', () => h.act(c => c.synchronize(true)));
    const rebuilt = { cursor: h.replica.cursor, snapshots: calls.filter((item) => item === 'snapshot').length, status: h.status };

    assert.match(failed.status, /业务服务同步未推进/, '同步失败应回显服务错误');
    assert.equal(failed.outbox, 1, '同步失败必须保留待确认编辑');
    assert.equal(failed.saved, 0, '同步失败不得写入新的本机副本');
    assert.equal(failed.calls, 'mutate:m1', '同步应先发送待确认编辑再拉取');
    assert.equal(synced.outbox, 0, '同步成功应清空已确认的待同步编辑');
    assert.equal(synced.cursor, 0, '拉取到游标 0 时应记录该游标');
    assert.equal(synced.entity, '待同步计划', '同步成功应写入远端确认实体');
    assert.match(synced.status, /本次操作已保存/, '同步成功应提示状态以列表为准');
    assert.equal(rebuilt.cursor, 9, '重建应使用快照游标替换本机游标');
    assert.equal(rebuilt.snapshots, 1, '重建应只请求一次快照');
    assert.match(rebuilt.status, /本次操作已保存/, '重建成功应提示状态以列表为准');
  });

  await test('V2-01', '完成框仅在保存成功后确认，失败回退，日历事项同样可勾选', async ui => {
    const h = componentHandlers('DailyPlanCard', '  aboutToAppear()', '  build()', {});
    h.item = { id: 'p', title: '任务', status: 'doing' }; h.writable = true;
    h.changeStatus = async (_id, status) => { h.item = { ...h.item, status }; };
    h.aboutToAppear(); assert.equal(h.checked, false);
    await ui.click('完成框：进行中 → 已完成', () => h.complete(true));
    assert.equal(h.item.status, 'done'); assert.equal(h.checked, true);
    await ui.click('取消勾选 → 待完成', () => h.complete(false));
    assert.equal(h.item.status, 'todo'); assert.equal(h.checked, false);
    h.changeStatus = async () => {};
    await ui.click('本机保存失败', () => h.complete(true));
    assert.equal(h.checked, false); assert.equal(h.item.status, 'todo');
    h.changeStatus = async () => { throw Error('save failed'); };
    await assert.rejects(() => h.complete(true), /save failed/); assert.equal(h.checked, false);
    h.writable = false; await h.complete(true); assert.equal(h.checked, false);
    h.writable = true; h.item.calendarSource = { key: 'calendar' };
    h.changeStatus = async (_id, status) => { h.item = { ...h.item, status }; };
    await ui.click('日历事项：待完成 → 已完成', () => h.complete(true));
    assert.equal(h.item.status, 'done'); assert.equal(h.checked, true);
    await ui.click('日历事项取消勾选 → 待完成', () => h.complete(false));
    assert.equal(h.item.status, 'todo'); assert.equal(h.checked, false);
  });
  await test('V2-02', '撤销恢复原三态并拒绝跨空间、已修改或已移除对象', async ui => {
    const { h, saved } = openPage('V2Undo', ['nav', 'commit', 'plan']);
    const space = w.activeSpace(h.data);
    space.plans.push({ id: 'p', title: '行动', date: h.planDate, status: 'doing', projectId: '' });
    await ui.click('勾选完成', () => h.setPlan('p', 'done'));
    assert.equal(w.activeSpace(h.data).plans[0].status, 'done');
    await ui.click('撤销', () => h.undoPlanStatus());
    assert.equal(w.activeSpace(h.data).plans[0].status, 'doing'); assert.equal(h.undoPlanId, '');
    await h.undoPlanStatus(); assert.equal(saved.length, 2);
    await h.setPlan('p', 'done'); w.activeSpace(h.data).plans[0].note = '之后编辑';
    const count = saved.length;
    await h.undoPlanStatus(); assert.equal(saved.length, count); assert.match(h.feedback, /事项或空间已变化/);
    await h.setPlan('p', 'todo'); h.undoSpace = 'another'; await h.undoPlanStatus(); assert.equal(saved.length, count + 1);
    await h.setPlan('p', 'done'); w.activeSpace(h.data).plans = []; await h.undoPlanStatus();
    assert.match(h.feedback, /事项或空间已变化/);
    const failed = openPage('V2UndoFail', ['nav', 'commit', 'plan']);
    w.activeSpace(failed.h.data).plans.push({ id: 'p', title: '行动', date: failed.h.planDate, status: 'todo', projectId: '' });
    failed.h.repository.save = async () => { throw Error('disk full'); };
    await failed.h.setPlan('p', 'done'); assert.equal(w.activeSpace(failed.h.data).plans[0].status, 'todo');
    assert.equal(failed.h.undoPlanId, undefined);
  });
  await test('V2-03', '模态返回、草稿及本次上下文按空间和需求恢复', async ui => {
    const { h } = openPage('V2Context', ['nav']);
    h.route = 'business';
    h.scroller.currentOffset = () => { throw Error('unmounted'); };
    h.remember();
    h.route = 'project-business/p'; h.remember();
    h.route = ''; h.scroller.currentOffset = () => undefined; h.remember();
    h.scroller.currentOffset = () => ({ yOffset: 0 });
    h.route = 'chat/a'; h.chatDraft = '未发送的输入'; h.shareCalendar = true;
    h.snapshot = { calendar: '已确认来源', device: '', capturedAt: 123 };
    await ui.click('离开需求 A', () => h.go('chat/b'));
    assert.equal(h.chatDraft, ''); assert.equal(h.shareCalendar, false);
    h.chatDraft = 'B 的输入'; h.shareDevice = true;
    await ui.click('返回需求 A', () => h.back());
    assert.equal(h.chatDraft, '未发送的输入'); assert.equal(h.shareCalendar, true); assert.equal(h.snapshot.capturedAt, 123);
    h.detail = 'context'; assert.equal(h.onBackPress(), true); assert.equal(h.detail, ''); assert.equal(h.route, 'chat/a');
    h.remember(); h.data.activeServer = 'another'; h.restore();
    assert.equal(h.chatDraft, ''); assert.equal(h.shareCalendar, false); assert.equal(h.shareDevice, false);
    h.data.activeServer = 'local'; h.restore(); assert.equal(h.chatDraft, '未发送的输入');
    const panel = openPanel({ project: { id: 'p', name: '目标', goal: '目标', criteria: '标准', managedBy: 'manual', nextStep: '' } });
    panel.h.section = 'reviews'; panel.h.aboutToDisappear(); panel.h.section = 'overview'; panel.h.aboutToAppear();
    assert.equal(panel.h.section, 'reviews');
    const late = openPage('V2LateReply', ['nav', 'commit', 'connection', 'send']).h;
    w.selectConnection(late.data, connection());
    const originServer = late.data.activeServer;
    const first = w.createNeed(w.activeSpace(late.data), 'A', 'independent', '');
    const second = w.createNeed(w.activeSpace(late.data), 'B', 'independent', '');
    late.route = 'chat/' + first.id; late.chatDraft = 'A 输入';
    late.selectedNeed = () => w.activeSpace(late.data).needs.find(need => late.route === 'chat/' + need.id);
    let resolveToken; let reply; let sent;
    late.credentials.read = () => new Promise(resolve => { resolveToken = resolve; });
    late.client = { chat: async (_settings, _token, request) => { sent = request; return new Promise(resolve => { reply = resolve; }); } };
    const sending = late.send(); await tick();
    late.go('chat/' + second.id); late.chatDraft = 'B 草稿'; late.shareDevice = true;
    resolveToken('fixture-token'); await tick();
    assert.equal(sent.messages[sent.messages.length - 1].content, 'A 输入');
    reply('A 回复'); await sending;
    assert.equal(late.chatDraft, 'B 草稿'); assert.equal(late.shareDevice, true);
    assert.equal(late.data.spaces.find(space => space.serverKey === originServer).needs.find(need => need.id === first.id).messages.length, 2);
    assert.equal(late.selectedNeed().messages.length, 0);
  });
  await test('V2-04', '消息正文保留长文、代码、表格与安全链接，不解释 HTML', async () => {
    const file = path.join(__dirname, '../entry/src/main/ets/components/MessageContent.ets');
    const source = fs.readFileSync(file, 'utf8').split('@Component')[0];
    const sandbox = { exports: {} };
    vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2021, module: ts.ModuleKind.CommonJS } }).outputText, sandbox, { filename: file });
    const { messageBlocks, messageSpans } = sandbox.exports;
    const blocks = messageBlocks('长回复\n```ts\nconst value = 1;\n```\n|来源|结果|\n|---|:---:|\n|笔记|已整理|\n后续内容');
    assert.equal(blocks.length, 4); assert.equal(blocks[1].kind, 'code'); assert.equal(blocks[1].text, 'const value = 1;');
    assert.equal(blocks[2].rows.length, 2); assert.equal(blocks[2].rows[1][1], '已整理');
    assert.equal(messageBlocks('```\n未闭合代码')[0].kind, 'code');
    assert.equal(messageBlocks('|a|b|').length, 1); assert.equal(messageBlocks('').length, 1);
    assert.equal(messageBlocks('正文\n|列|值|')[0].text, '正文');
    const spans = messageSpans('见 [来源](https://example.org/a) 和 **重点**。');
    assert.equal(spans[1].url, 'https://example.org/a'); assert.equal(spans[3].strong, true);
    assert.equal(messageSpans('[危险](javascript:alert(1))')[0].url, '');
    assert.equal(messageSpans('<script>text</script>')[0].text, '<script>text</script>');
  });

  console.log(`\n${passed} interactive flow tests passed; Index.ets methods driven by simulated clicks, platform APIs mocked, not device acceptance.`);
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
