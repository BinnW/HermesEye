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
const d = load('core/Domain.ts');
const w = load('core/Workspace.ts', { './Domain': d, './Reading': load('core/Reading.ts') });
let passed = 0;
async function test(name, action) { await action(); passed++; console.log('PASS ' + name); }
function connection(host = 'example.org') {
  return { name: 'Home', host, protocol: 'https', port: 443, basePath: '', model: 'hermes-agent', allowPrivateHttp: false, autoConnect: false, credentialRef: 'secure-ref' };
}
function project(id = 'p1') { return { id, name: 'Learn', goal: 'Understand', managedBy: 'manual', nextStep: '' }; }
function record(overrides = {}) { return { id: 'r1', text: 'Learned something', unfinished: '', energy: '', decision: '', nextTodo: '', start: null, end: null, createdAt: Date.now(), backfilled: false, ...overrides }; }
function book(id = 'b1') {
  return { id, title: 'Book', progress: null, notes: null, highlights: null, thoughts: null,
    weeklySummaries: null, source: 'WeRead', updatedAt: 1, excerpts: [], summaries: [] };
}
function plan(overrides = {}) { return { id: 'plan1', date: '2026-10-01', title: 'Read', status: 'todo', projectId: '', ...overrides }; }
function richWorkspace() {
  const data = w.newWorkspace(); const space = w.activeSpace(data);
  space.projects.push(project());
  const need = w.createNeed(space, 'Learn', 'project', 'p1');
  need.messages.push({ role: 'user', content: 'hello' }, { role: 'assistant', content: 'hi' });
  space.plans.push({ ...plan({ projectId: 'p1', priority: 'normal', minutes: 30, note: 'note',
    suggestionKey: 'plan/src', suggestionReason: 'from record' }) });
  space.records.push(record());
  space.books.push(book());
  space.runs.push({ id: 'run1', needId: need.id, status: 'ok', updatedAt: 1, events: [], artifacts: [], deployment: 'local' });
  space.reminders.push({ id: 't1', title: 'Read', time: '08:30', weekdays: false, reminderId: 1 });
  space.lastSyncAt = 1;
  w.linkedNeed(space, 'Learn', 'project', 'p1');
  return data;
}
function withSpace(mutate) {
  const data = w.newWorkspace();
  mutate(w.activeSpace(data));
  return data;
}
function projectDetails(overrides = {}) {
  return { id: 'p1', name: 'Learn', goal: 'Understand', managedBy: 'manual', nextStep: '', kind: 'learning',
    status: 'active', criteria: 'Explain it', targetDate: '2026-12-31', milestones: [], reviews: [], ...overrides };
}
function milestone(overrides = {}) { return { id: 'm1', title: 'Step', dueDate: '', done: false, ...overrides }; }
function review(overrides = {}) { return { id: 'v1', text: 'Note', createdAt: 1, ...overrides }; }
function newDraft(overrides = {}) {
  return Object.assign(new w.ProjectDraft(), { name: 'Learn', goal: 'Understand', criteria: 'Explain it' }, overrides);
}

function sendHarness() {
  const page = fs.readFileSync(path.join(__dirname, '../entry/src/main/ets/pages/Index.ets'), 'utf8');
  const method = page.slice(page.indexOf('  private async send()'), page.indexOf('  private async refreshCalendar()'));
  const compiled = ts.transpileModule('class Harness {' + method + '} exports.Harness = Harness;', {
    compilerOptions: { target: ts.ScriptTarget.ES2021, module: ts.ModuleKind.CommonJS }
  }).outputText;
  const sandbox = { exports: {}, copyWorkspace: w.copyWorkspace, activeSpace: w.activeSpace,
    serverKey: w.serverKey, createRequest: d.createRequest };
  vm.runInNewContext(compiled, sandbox, { filename: path.join(__dirname, '../entry/src/main/ets/pages/Index.ets') });
  const h = new sandbox.exports.Harness();
  h.data = w.newWorkspace(); w.selectConnection(h.data, connection());
  const need = w.createNeed(w.activeSpace(h.data), 'Chat', 'independent', '');
  h.ready = true; h.busy = false; h.chatDraft = 'hello'; h.drafts = new Map(); h.contextDrafts = new Map();
  h.routeKey = () => 'server/chat'; h.selectedNeed = () => w.activeSpace(h.data).needs.find(n => n.id === need.id);
  h.sharePreview = () => ''; h.settings = () => ({}); h.notice = () => {};
  h.credentials = { read: async () => 'test-token' }; h.repository = { save: async () => {} };
  return h;
}
async function main() {
  await test('V2 material preference accepts old workspaces and boolean choices but rejects corrupt values', () => {
    const data = w.newWorkspace();
    w.validateWorkspace(data);
    data.solidSurfaces = false; w.validateWorkspace(data);
    data.solidSurfaces = true; w.validateWorkspace(w.copyWorkspace(data));
    data.solidSurfaces = 'enabled'; assert.throws(() => w.validateWorkspace(data), /材质偏好/);
    assert.throws(() => w.validateWorkspace(null));
  });
  await test('reading snapshots preserve real percent units, captured question sources and legacy books', () => {
    const reading = load('core/Reading.ts');
    const entry = { id: 'e1', kind: 'highlight', text: 'source', location: 'chapter:1' };
    const question = { id: 'q1', bookId: 'b1', entryId: 'e1', sourceEntry: entry,
      origin: 'user', text: 'Why?', needId: 'question-1', interactions: [] };
    const fixture = () => ({ books: [{ id: 'b1', title: 'Book', source: '微信读书', updatedAt: 1,
      progress: 1, progressUnit: 'percent', sourceUpdatedAt: null, organized: '', entries: [entry], questions: [question], cycles: [] }],
      policy: { bookIds: [], enabled: false, intervalHours: 24, timezone: 'Asia/Shanghai', consent: false }, sourceConfigured: false });
    const valid = fixture(); assert.equal(reading.validateReadingSnapshot(valid), valid);
    valid.books[0].progress = null; reading.validateReadingSnapshot(valid);
    // A previously asked question keeps its own source even when the latest batch differs.
    valid.books[0].entries = []; reading.validateReadingSnapshot(valid);
    const workspace = richWorkspace(); w.activeSpace(workspace).readingSnapshot = valid;
    assert.equal(w.validateWorkspace(workspace), workspace);
    assert.equal(w.activeSpace(w.copyWorkspace(workspace)).books[0].id, 'b1');
    for (const value of [null, {}, { books: {} }, { books: [] }, { books: [], policy: {} }]) {
      assert.throws(() => reading.validateReadingSnapshot(value), /阅读副本/);
    }
    const patches = [{ id: '' }, { title: '' }, { source: '' }, { updatedAt: NaN }, { updatedAt: 0 },
      { progress: 1.2 }, { progress: -1 }, { progress: 101 }, { progressUnit: 'fraction' }, { entries: {} },
      { questions: {} }, { cycles: {} }, { organized: null }];
    for (const patch of patches) {
      const item = fixture(); Object.assign(item.books[0], patch);
      assert.throws(() => reading.validateReadingSnapshot(item), /阅读来源/);
    }
    for (const patch of [{ id: '' }, { kind: 'assistant' }, { text: null }, { location: null }]) {
      const item = fixture(); item.books[0].entries = [{ ...entry, ...patch }];
      assert.throws(() => reading.validateReadingSnapshot(item), /笔记来源/);
    }
    for (const patch of [{ id: '' }, { bookId: 'other' }, { sourceEntry: null }, { entryId: 'other' },
      { origin: 'ai' }, { needId: '' }, { text: '' }, { interactions: {} }]) {
      const item = fixture(); item.books[0].questions = [{ ...question, ...patch }];
      assert.throws(() => reading.validateReadingSnapshot(item), /疑问关联/);
    }
    const project = projectDetails({ reviews: [review({ text: 'actual review' })] });
    assert.match(w.projectBrief(project), /actual review/);
  });

  await test('production send failure keeps the attempted prompt visible with its error', async () => {
    const h = sendHarness();
    h.client = { chat: async () => { throw Error('timeout'); } };
    await h.send();
    assert.equal(h.pendingPrompt, 'hello'); assert.equal(h.pendingKey, 'server/chat');
    assert.match(h.sendError, /timeout/); assert.equal(h.sending, false);
  });
  await test('production send success never touches another conversation draft', async () => {
    const h = sendHarness(); let finish;
    h.client = { chat: () => new Promise(resolve => { finish = resolve; }) };
    const running = h.send(); await new Promise(resolve => setImmediate(resolve));
    h.selectedNeed = () => undefined; h.routeKey = () => 'server/other'; h.chatDraft = 'other draft';
    finish('answer'); await running;
    assert.equal(h.chatDraft, 'other draft'); assert.equal(h.drafts.get('server/chat'), '');
  });
  await test('production send shows pending input while transport waits and commits one pair', async () => {
    const h = sendHarness(); let finish; let calls = 0;
    h.client = { chat: () => { calls++; return new Promise(resolve => { finish = resolve; }); } };
    const running = h.send(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(h.pendingPrompt, 'hello'); assert.equal(h.sending, true);
    assert.equal(h.selectedNeed().messages.length, 0);
    await h.send(); assert.equal(calls, 1);
    finish('answer'); await running;
    assert.equal(h.pendingPrompt, ''); assert.equal(h.sending, false);
    assert.equal(h.selectedNeed().messages.length, 2); assert.equal(h.chatDraft, '');
  });
  await test('production send retains input on network failure without retry', async () => {
    const h = sendHarness(); let calls = 0;
    h.client = { chat: async () => { calls++; throw Error('timeout'); } };
    await h.send(); assert.equal(calls, 1); assert.equal(h.chatDraft, 'hello');
    assert.equal(h.sendError, 'timeout'); assert.equal(h.sending, false);
    assert.equal(h.selectedNeed().messages.length, 0);
  });
  await test('production send keeps reply in memory and removes duplicate pending bubble after disk failure', async () => {
    const h = sendHarness(); h.client = { chat: async () => 'answer' };
    h.repository.save = async () => { throw Error('disk'); };
    await h.send(); assert.equal(h.ready, false); assert.equal(h.pendingPrompt, '');
    assert.equal(h.selectedNeed().messages.length, 2); assert.match(h.sendError, /保存失败/);
  });

  await test('calendar import selects explicitly, deduplicates and preserves project and source', () => {
    const data = w.newWorkspace(); const space = w.activeSpace(data); space.projects.push(project());
    const entries = [
      { key: '1/1/100', title: 'Meeting', start: 100, end: 200, allDay: false },
      { key: '1/1/300', title: 'Meeting', start: 300, end: 400, allDay: false }
    ];
    assert.equal(w.importCalendarPlans(space, entries, [entries[0].key], '2026-10-03', 'p1'), 1);
    assert.equal(w.importCalendarPlans(space, entries, entries.map(e => e.key), '2026-10-03', 'p1'), 1);
    assert.equal(space.plans.length, 2); assert.equal(space.plans[0].status, 'todo');
    assert.equal(space.plans[0].projectId, 'p1'); assert.equal(space.plans[0].calendarSource.start, 100);
    assert.equal(w.importCalendarPlans(w.activeSpace(w.newWorkspace()), entries, ['1/1/100'], '2026-10-03', ''), 1);
    w.validateWorkspace(data);
  });
  await test('calendar import in a detached snapshot does not modify saved data', () => {
    const data = w.newWorkspace(); const next = w.copyWorkspace(data);
    w.importCalendarPlans(w.activeSpace(next), [{ key: '1', title: 'Meeting', start: 1, end: 2, allDay: true }], ['1'], '2026-10-03', '');
    assert.equal(w.activeSpace(data).plans.length, 0);
    assert.throws(() => w.importCalendarPlans(w.activeSpace(next), [], [], 'bad', ''), /日期/);
    assert.throws(() => w.importCalendarPlans(w.activeSpace(next), [], [], '2026-10-03', 'missing'), /项目/);
  });
  await test('calendar import ignores empty selections and deduplicates per space', () => {
    const data = w.newWorkspace(); const space = w.activeSpace(data);
    const entries = [{ key: '7/1/100', title: 'Meeting', start: 100, end: 200, allDay: false }];
    assert.equal(w.importCalendarPlans(space, entries, [], '2026-10-03', ''), 0);
    assert.equal(space.plans.length, 0);
    data.spaces.push(w.newSpace('https://example.org:443/v1'));
    const remote = data.spaces[1];
    assert.equal(w.importCalendarPlans(space, entries, ['7/1/100'], '2026-10-03', ''), 1);
    assert.equal(w.importCalendarPlans(remote, entries, ['7/1/100'], '2026-10-03', ''), 1);
    assert.equal(space.plans.length, 1); assert.equal(remote.plans.length, 1);
    w.validateWorkspace(data);
  });
  await test('invalid calendar sources are rejected while legacy plans stay valid', () => {
    const data = w.newWorkspace(); const space = w.activeSpace(data);
    space.plans.push({ id: 'legacy', date: '2026-10-01', title: 'Old', status: 'todo', projectId: '' });
    w.validateWorkspace(data);
    space.plans.push({ id: 'imported', date: '2026-10-01', title: 'M', status: 'todo', projectId: '',
      calendarSource: { key: 'k', title: 'M', start: 200, end: 100, allDay: false } });
    assert.throws(() => w.validateWorkspace(data), /日历来源/);
    space.plans[1].calendarSource = { key: '', title: 'M', start: 100, end: 200, allDay: false };
    assert.throws(() => w.validateWorkspace(data), /日历来源/);
    space.plans[1].calendarSource = { key: 'k', title: 'M', start: 100, end: 200, allDay: 'yes' };
    assert.throws(() => w.validateWorkspace(data), /日历来源/);
    space.plans[1].calendarSource = { key: 'k', title: 'M', start: 100, end: 200, allDay: false };
    w.validateWorkspace(data);
  });
  await test('oversized calendar titles fail the import before any persistence', () => {
    const data = w.newWorkspace();
    const entries = [
      { key: 'a', title: 'Fine', start: 100, end: 200, allDay: false },
      { key: 'b', title: 'x'.repeat(201), start: 300, end: 400, allDay: false }
    ];
    const next = w.copyWorkspace(data);
    assert.throws(() => w.importCalendarPlans(w.activeSpace(next), entries, ['a', 'b'], '2026-10-03', ''));
    assert.equal(w.activeSpace(data).plans.length, 0);
    assert.throws(() => w.importCalendarPlans(w.activeSpace(w.newWorkspace()), entries, ['b'], '2026-10-03', ''));
  });

  await test('fresh workspace contains no fabricated remote statistics', () => {
    const data = w.validateWorkspace(w.newWorkspace());
    assert.equal(data.activeServer, 'local'); assert.equal(w.activeSpace(data).books.length, 0); assert.equal(w.activeSpace(data).lastSyncAt, null);
  });
  await test('migration preserves notes, reminders and assigns old chat an independent need', () => {
    const old = d.initialData(); old.notes.push({ id: 'n1', text: 'legacy', createdAt: 1 });
    old.messages.push({ role: 'user', content: 'old prompt' }, { role: 'assistant', content: 'old answer' });
    old.tasks.push({ id: 't1', title: 'Read', time: '08:30', weekdays: false, reminderId: 17 });
    const data = w.validateWorkspace(w.migrateLegacy(old)); const space = w.activeSpace(data);
    assert.equal(space.records[0].start, null); assert.equal(space.records[0].text, 'legacy');
    assert.equal(space.needs[0].ownerKind, 'independent'); assert.equal(space.needs[0].messages.length, 2);
    assert.equal(space.reminders[0].reminderId, 17); assert.equal(data.connection, null);
  });
  await test('migration retains valid connection fields without inventing a credential or uploading data', () => {
    const old = d.initialData(); old.settings.baseUrl = 'https://example.org:8443/hermes/v1';
    const data = w.validateWorkspace(w.migrateLegacy(old));
    assert.equal(data.connection.port, 8443); assert.equal(data.connection.basePath, '/hermes/v1');
    assert.equal(data.connection.credentialRef, ''); assert.equal(data.connection.autoConnect, false); assert.equal(data.activeServer, 'local');
  });
  await test('corrupt legacy data cannot silently become an empty workspace', () => {
    assert.throws(() => w.migrateLegacy({ ...d.initialData(), notes: [null] }));
  });
  await test('same-name aimless needs have independent identifiers and histories', () => {
    const space = w.newSpace('local'); const a = w.createNeed(space, '', 'independent', ''); const b = w.createNeed(space, '', 'independent', '');
    assert.equal(a.name, '漫无目的'); assert.notEqual(a.id, b.id);
    a.messages.push({ role: 'user', content: 'only A' }); assert.equal(b.messages.length, 0);
  });
  await test('linked plan reopens its existing need', () => {
    const space = w.newSpace('local'); space.plans.push({ id: 'plan', date: '2026-10-01', title: 'Read', status: 'todo', projectId: '' });
    const a = w.linkedNeed(space, 'Read', 'plan', 'plan'); const b = w.linkedNeed(space, 'Read', 'plan', 'plan');
    assert.equal(a.id, b.id); assert.equal(space.needs.length, 1);
    space.projects.push(project()); w.moveNeed(space, a.id, 'Moved', 'p1');
    assert.equal(w.linkedNeed(space, 'Read', 'plan', 'plan').id, a.id);
  });
  await test('invalid owners cannot create orphan conversations', () => {
    const space = w.newSpace('local'); assert.throws(() => w.createNeed(space, 'bad', 'project', 'missing'));
    assert.throws(() => w.createNeed(space, 'bad', 'independent', 'unexpected'));
  });
  await test('rename and move retain original identity and history', () => {
    const space = w.newSpace('local'); space.projects.push(project()); const need = w.createNeed(space, '', 'independent', '');
    need.messages.push({ role: 'assistant', content: 'preserved' }); w.moveNeed(space, need.id, 'Named', 'p1');
    assert.equal(space.needs.length, 1); assert.equal(need.ownerId, 'p1'); assert.equal(need.messages[0].content, 'preserved');
    assert.throws(() => w.moveNeed(space, need.id, 'No', 'missing')); assert.equal(need.name, 'Named');
  });
  await test('server selection separates local data and distinct origins', () => {
    const data = w.newWorkspace(); w.activeSpace(data).records.push(record());
    w.selectConnection(data, connection()); assert.equal(w.activeSpace(data).records.length, 0);
    w.createNeed(w.activeSpace(data), 'server A', 'independent', '');
    w.selectConnection(data, connection('second.example.org')); assert.equal(w.activeSpace(data).needs.length, 0);
    w.selectConnection(data, connection()); assert.equal(w.activeSpace(data).needs[0].name, 'server A');
    assert.equal(data.spaces[0].records.length, 1); w.validateWorkspace(data);
  });
  await test('canonical address normalizes case and validates ports and credentials', () => {
    assert.equal(w.serverKey(connection('EXAMPLE.org')), 'https://example.org:443/v1');
    [0, 65536, 3.5, NaN].forEach(port => assert.throws(() => w.connectionUrl({ ...connection(), port })));
    ['a@b.com', 'a.com?token=x', 'https://a.com', 'a.com/x', 'a..com'].forEach(host => assert.throws(() => w.connectionUrl(connection(host))));
  });
  await test('Tailscale range requires HTTP opt-in and rejects public boundary addresses', () => {
    assert.throws(() => w.connectionUrl({ ...connection('100.64.0.1'), protocol: 'http' }));
    assert.equal(w.connectionUrl({ ...connection('100.64.0.1'), protocol: 'http', allowPrivateHttp: true }), 'http://100.64.0.1:443/v1');
    ['100.63.255.255', '100.128.0.1', '8.8.8.8'].forEach(host => assert.throws(() => w.connectionUrl({ ...connection(host), protocol: 'http', allowPrivateHttp: true })));
  });
  await test('daily counts distinguish dates and explicit statuses, calendar items included', () => {
    const space = w.newSpace('local');
    space.plans = ['todo', 'doing', 'done'].map((status, i) => ({ id: String(i), date: '2026-10-01', title: status, status, projectId: '' }));
    space.plans.push({ id: 'other', date: '2026-10-02', title: 'other', status: 'done', projectId: '' });
    assert.deepEqual(Array.from(w.planCounts(space, '2026-10-01')), [1, 1, 1]);
    space.plans.push({ id: 'cal', date: '2026-10-01', title: 'Meeting', status: 'todo', projectId: '',
      calendarSource: { key: 'k', title: 'M', start: 1, end: 2, allDay: false } });
    assert.deepEqual(Array.from(w.planCounts(space, '2026-10-01')), [1, 1, 2], '2026-10-17 起日历事项计入事务完成统计');
    space.plans.find(item => item.id === 'cal').status = 'done';
    assert.deepEqual(Array.from(w.planCounts(space, '2026-10-01')), [2, 1, 1], '日历事项完成状态变化应反映到统计');
    assert.equal(w.validDate('2026-02-30'), false); assert.equal(w.validDate('2028-02-29'), true);
  });
  await test('interval record permits text-only and rejects partial, reversed or future periods', () => {
    w.validateRecord(record());
    assert.throws(() => w.validateRecord(record({ start: 1 })));
    assert.throws(() => w.validateRecord(record({ start: 2, end: 1 })));
    assert.throws(() => w.validateRecord(record({ start: 1, end: Date.now() + 60000 })));
    assert.throws(() => w.validateRecord(record({ text: '' })));
  });
  await test('report uses occurrence date and identifies backfills and missing coverage', () => {
    const space = w.newSpace('local');
    assert.match(w.dailyReport(space, '2026-09-01'), /暂无/);
    space.records.push(record({ start: new Date('2026-09-01T09:00').getTime(), end: new Date('2026-09-01T10:00').getTime(), backfilled: true, nextTodo: 'Review' }));
    const report = w.dailyReport(space, '2026-09-01'); assert.match(report, /补记/); assert.match(report, /完整性未知/); assert.match(report, /来源记录 r1/); assert.match(report, /Review/);
    assert.match(w.dailyReport(space, '2026-08-31'), /暂无/);
  });
  await test('local history has no inherited 100-message persistence limit', () => {
    const data = w.newWorkspace(); const need = w.createNeed(w.activeSpace(data), '', 'independent', '');
    need.messages = Array.from({ length: 300 }, () => ({ role: 'user', content: 'stored' })); w.validateWorkspace(data);
    assert.equal(need.messages.length, 300);
  });
  await test('validation rejects duplicates, dangling ownership and invalid statistics', () => {
    const data = w.newWorkspace(); const space = w.activeSpace(data); space.projects.push(project(), project());
    assert.throws(() => w.validateWorkspace(data)); space.projects.pop();
    const need = w.createNeed(space, 'project need', 'project', 'p1'); need.ownerId = 'absent'; assert.throws(() => w.validateWorkspace(data));
    need.ownerId = 'p1'; space.books.push({ id: 'b', title: 'Book', progress: null, notes: null, highlights: null, thoughts: null, weeklySummaries: null, source: 'WeRead', updatedAt: 1, excerpts: [], summaries: [] });
    w.validateWorkspace(data); space.books[0].notes = -1; assert.throws(() => w.validateWorkspace(data));
  });
  await test('workspace copies are fully detached from the persisted snapshot', () => {
    const data = w.newWorkspace(); const need = w.createNeed(w.activeSpace(data), '', 'independent', '');
    need.messages.push({ role: 'user', content: 'original' });
    const draft = w.copyWorkspace(data);
    w.activeSpace(draft).needs[0].messages.push({ role: 'assistant', content: 'reply' });
    w.activeSpace(draft).plans.push({ id: 'p', date: '2026-10-01', title: 'x', status: 'todo', projectId: '' });
    assert.equal(w.activeSpace(data).needs[0].messages.length, 1);
    assert.equal(w.activeSpace(data).plans.length, 0);
  });
  await test('a committed send lives only in the new snapshot the chat page must render', () => {
    // Emulator regression (docs/issues/10): the chat page went stale because it kept rendering the pre-send object.
    const data = w.newWorkspace(); const need = w.createNeed(w.activeSpace(data), '', 'independent', '');
    const next = w.copyWorkspace(data);
    const target = w.activeSpace(next).needs.find(item => item.id === need.id);
    target.messages.push({ role: 'user', content: 'prompt' }, { role: 'assistant', content: 'answer' });
    assert.equal(need.messages.length, 0);
    const rendered = w.activeSpace(next).needs.find(item => item.id === need.id);
    assert.notEqual(rendered, need); assert.equal(rendered.messages.length, 2);
    w.validateWorkspace(next);
  });
  await test('a workspace pointing at a missing space is rejected', () => {
    const data = w.newWorkspace(); data.activeServer = 'https://gone.example.org:443/v1';
    assert.throws(() => w.activeSpace(data));
    assert.throws(() => w.validateWorkspace(data));
  });
  await test('connection must match the active remote space', () => {
    const data = w.newWorkspace(); w.selectConnection(data, connection());
    data.activeServer = 'https://other.example.org:443/v1';
    data.spaces.push(w.newSpace('https://other.example.org:443/v1'));
    assert.throws(() => w.validateWorkspace(data), /不匹配/);
  });
  await test('a stored link to a missing conversation fails loudly instead of recreating it', () => {
    const space = w.newSpace('local'); space.projects.push(project());
    const need = w.linkedNeed(space, 'Learn', 'project', 'p1');
    space.needs = space.needs.filter(item => item.id !== need.id);
    assert.throws(() => w.linkedNeed(space, 'Learn', 'project', 'p1'), /关联会话不存在/);
  });
  await test('renaming to blank is rejected and keeps identity', () => {
    const space = w.newSpace('local'); const need = w.createNeed(space, 'Keep', 'independent', '');
    assert.throws(() => w.moveNeed(space, need.id, '   ', ''));
    assert.equal(need.name, 'Keep');
  });
  await test('text-only records report under their save date', () => {
    const space = w.newSpace('local');
    space.records.push(record({ createdAt: new Date('2026-09-02T08:00').getTime() }));
    const report = w.dailyReport(space, '2026-09-02');
    assert.match(report, /来源记录 r1/); assert.match(report, /未标明事件区间/);
    assert.match(w.dailyReport(space, '2026-09-01'), /暂无/);
  });
  await test('migration ignores malformed historical addresses but keeps data local', () => {
    const old = d.initialData(); old.notes.push({ id: 'n', text: 'legacy', createdAt: 1 });
    old.settings.baseUrl = 'not a url';
    const data = w.validateWorkspace(w.migrateLegacy(old));
    assert.equal(data.connection, null); assert.equal(w.activeSpace(data).records.length, 1);
  });
  await test('migration applies scheme default ports and keeps the private-HTTP choice', () => {
    const secure = d.initialData(); secure.settings.baseUrl = 'https://example.org';
    assert.equal(w.migrateLegacy(secure).connection.port, 443);
    const plain = d.initialData(); plain.settings.baseUrl = 'http://192.168.1.8'; plain.settings.allowLocalHttp = true;
    const migrated = w.migrateLegacy(plain);
    assert.equal(migrated.connection.port, 80); assert.equal(migrated.connection.allowPrivateHttp, true);
  });
  function toastHarness() {
    const page = fs.readFileSync(path.join(__dirname, '../entry/src/main/ets/pages/Index.ets'), 'utf8');
    const method = page.slice(page.indexOf('  private notice('), page.indexOf('  private remember()'));
    const compiled = ts.transpileModule('class ToastHarness {' + method + '} exports.ToastHarness = ToastHarness;', {
      compilerOptions: { target: ts.ScriptTarget.ES2021, module: ts.ModuleKind.CommonJS }
    }).outputText;
    const presentation = load('services/SystemPresentation.ets', { '@kit.AbilityKit': { ConfigurationConstant: {} } });
    const sandbox = { exports: {}, showToast: presentation.showToast };
    vm.runInNewContext(compiled, sandbox);
    const h = new sandbox.exports.ToastHarness();
    const toasts = [];
    h.getUIContext = () => ({ getPromptAction: () => ({ showToast: (options) => toasts.push(options) }) });
    return { h, toasts };
  }
  await test('operation feedback toasts deduplicate briefly and extend errors', () => {
    const { h, toasts } = toastHarness();
    h.notice('saved'); h.notice('saved');
    assert.equal(toasts.length, 1); assert.equal(toasts[0].duration, 3000);
    h.notice('failed', true);
    assert.equal(toasts.length, 2); assert.equal(toasts[1].duration, 5000);
    h.lastToastAt = Date.now() - 2000; h.notice('failed', true);
    assert.equal(toasts.length, 3);
  });
  await test('failed Toast is not marked displayed and the same feedback may be shown after recovery', () => {
    const { h, toasts } = toastHarness();
    const context = h.getUIContext;
    h.getUIContext = () => ({ getPromptAction: () => ({ showToast() { throw Object.assign(Error('secret'), { code: 100001 }); } }) });
    assert.doesNotThrow(() => h.notice('saved'));
    assert.notEqual(h.lastToast, 'saved');
    h.getUIContext = context; h.notice('saved'); assert.equal(toasts.length, 1);
  });
  await test('chat page renders live messages with the pending bubble below history', () => {
    const page = fs.readFileSync(path.join(__dirname, '../entry/src/main/ets/pages/Index.ets'), 'utf8');
    const messages = page.indexOf('ForEach(this.selectedNeed()?.messages ?? []');
    const pending = page.indexOf('if (this.pendingKey === this.routeKey())');
    const input = page.indexOf("  chatComposer()");
    assert.ok(messages > 0 && pending > messages && input > pending);
  });
  await test('V2 feedback remains visible near content and toast is supplementary', () => {
    const page = fs.readFileSync(path.join(__dirname, '../entry/src/main/ets/pages/Index.ets'), 'utf8');
    assert.ok(page.includes('showToast'));
    assert.ok(page.includes('@State feedback'));
    assert.ok(page.includes('this.feedbackFailed'));
    assert.ok(!page.includes('提示 · '));
  });
  const files = new Map(); let failRename = false, failWrite = false;
  const fileIo = {
    OpenMode: { CREATE: 1, WRITE_ONLY: 2, TRUNC: 4 }, accessSync: file => files.has(file),
    readTextSync: file => files.get(file).toString('utf8'), openSync(file) { files.set(file, Buffer.alloc(0)); return { fd: file }; },
    writeSync(fd, buffer) { if (failWrite) return 0; const bytes = Buffer.from(buffer).subarray(0, 11); files.set(fd, Buffer.concat([files.get(fd), bytes])); return bytes.length; },
    fsyncSync() {}, closeSync() {}, renameSync(from, to) { if (failRename) throw Error('disk failed'); files.set(to, files.get(from)); files.delete(from); }
  };
  const util = { TextEncoder, TextDecoder: { create() { return { decodeToString: value => new TextDecoder().decode(value) }; } } };
  class Encoder { encodeInto(value) { return new TextEncoder().encode(value); } }
  util.TextEncoder = Encoder;
  const Repository = load('services/WorkspaceRepository.ets', { '@kit.CoreFileKit': { fileIo }, '@kit.ArkTS': { util }, '../core/Workspace': w }).WorkspaceRepository;
  const repo = new Repository();
  await test('workspace migration is atomic and retains legacy source', async () => {
    files.set('/sandbox/hermes-eye-v1.json', Buffer.from(JSON.stringify(d.initialData())));
    const data = await repo.load({ filesDir: '/sandbox' }); assert.equal(data.version, 2);
    assert.ok(files.has('/sandbox/hermes-eye-v1.json')); assert.ok(files.has('/sandbox/hermes-eye-workspace-v2.json'));
  });
  await test('failed replacement or zero-byte write keeps previous persisted data', async () => {
    const data = await repo.load({ filesDir: '/sandbox' }); data.appearance = 2;
    failRename = true; await assert.rejects(() => repo.save(data)); failRename = false;
    assert.equal((await repo.load({ filesDir: '/sandbox' })).appearance, 0);
    failWrite = true; await assert.rejects(() => repo.save(data)); failWrite = false;
    assert.equal((await repo.load({ filesDir: '/sandbox' })).appearance, 0);
    await repo.save(data); assert.equal((await repo.load({ filesDir: '/sandbox' })).appearance, 2);
  });
  await test('damaged v2 never falls back to older data and overwrites it', async () => {
    files.set('/sandbox/hermes-eye-workspace-v2.json', Buffer.from('{broken'));
    await assert.rejects(() => repo.load({ filesDir: '/sandbox' }));
    assert.equal(files.get('/sandbox/hermes-eye-workspace-v2.json').toString(), '{broken');
  });
  let secureFailure = false; const secrets = new Map();
  const asset = {
    Tag: { ALIAS: 1, SECRET: 2, ACCESSIBILITY: 3, RETURN_TYPE: 4 }, Accessibility: { DEVICE_UNLOCKED: 2 }, ReturnType: { ALL: 0 },
    async add(map) { if (secureFailure) throw Error('secret backend failed'); assert.equal(map.get(3), 2); secrets.set(Buffer.from(map.get(1)).toString(), map.get(2)); },
    async query(map) { if (secureFailure) throw Error('locked'); const secret = secrets.get(Buffer.from(map.get(1)).toString()); return secret ? [new Map([[2, secret]])] : []; },
    async remove(map) { secrets.delete(Buffer.from(map.get(1)).toString()); }
  };
  const Credentials = load('services/CredentialStore.ets', { '@kit.AssetStoreKit': { asset }, '@kit.ArkTS': { util }, '../core/Workspace': w }).CredentialStore;
  const credentials = new Credentials();
  const Connections = load('services/ConnectionService.ets', { '../core/Workspace': w }).ConnectionService;
  let saved, configFails = false;
  const connectionService = new Connections({ async save(value) { if (configFails) throw Error('disk failure'); saved = JSON.stringify(value); } }, credentials);
  await test('secure credentials survive instance recreation and never enter business JSON', async () => {
    const data = await connectionService.save(w.newWorkspace(), connection(), 'test-only-token');
    assert.equal(saved.includes('test-only-token'), false); assert.ok(data.connection.credentialRef);
    assert.equal(await new Credentials().read(data.connection.credentialRef), 'test-only-token');
  });
  await test('secure-storage failure cannot write plaintext or report saved', async () => {
    const previous = saved; secureFailure = true;
    await assert.rejects(() => connectionService.save(w.newWorkspace(), connection(), 'other-token'), /安全存储失败/);
    assert.equal(saved, previous); secureFailure = false;
  });
  await test('configuration failure preserves previous credential and removes staged secret', async () => {
    const old = await connectionService.save(w.newWorkspace(), connection(), 'previous-token'); const before = secrets.size;
    configFails = true; await assert.rejects(() => connectionService.save(old, connection(), 'replacement-token'), /旧配置仍有效/); configFails = false;
    assert.equal(await credentials.read(old.connection.credentialRef), 'previous-token'); assert.equal(secrets.size, before);
  });
  await test('invalid connection is rejected before touching secure storage', async () => {
    const before = secrets.size;
    await assert.rejects(() => connectionService.save(w.newWorkspace(), { ...connection(), port: 0 }, 'token'));
    assert.equal(secrets.size, before);
  });
  await test('re-saving a connection replaces the old credential exactly once', async () => {
    const first = await connectionService.save(w.newWorkspace(), connection(), 'first-token');
    const afterFirst = secrets.size;
    const second = await connectionService.save(first, connection(), 'second-token');
    assert.equal(secrets.size, afterFirst);
    assert.equal(await credentials.read(second.connection.credentialRef), 'second-token');
    await assert.rejects(() => credentials.read(first.connection.credentialRef));
  });
  await test('blank token stages no secret and leaves the workspace unsaved', async () => {
    const before = secrets.size; const previousSaved = saved;
    await assert.rejects(() => connectionService.save(w.newWorkspace(), connection(), '  '), /Token/);
    assert.equal(secrets.size, before); assert.equal(saved, previousSaved);
  });

  await test('shiftDay moves across month boundaries and rejects invalid dates', () => {
    assert.equal(w.shiftDay('2026-10-01', 0), '2026-10-01');
    assert.equal(w.shiftDay('2026-10-01', 1), '2026-10-02');
    assert.equal(w.shiftDay('2026-03-01', -1), '2026-02-28');
    assert.throws(() => w.shiftDay('2026-13-01', 1), /日期/);
  });
  await test('savePlan validates every field before writing anything', () => {
    const space = w.newSpace('local'); space.projects.push(project());
    assert.throws(() => w.savePlan(space, '', 'bad', 'Read', '', 'normal', '', ''), /日期/);
    assert.throws(() => w.savePlan(space, '', '2026-10-01', '   ', '', 'normal', '', ''), /内容/);
    assert.throws(() => w.savePlan(space, '', '2026-10-01', 'Read', 'missing', 'normal', '', ''), /项目/);
    assert.throws(() => w.savePlan(space, '', '2026-10-01', 'Read', '', 'urgent', '', ''), /优先级/);
    assert.throws(() => w.savePlan(space, '', '2026-10-01', 'Read', '', 'normal', 'soon', ''), /预计用时/);
    assert.throws(() => w.savePlan(space, '', '2026-10-01', 'Read', '', 'normal', '-5', ''), /预计用时/);
    assert.throws(() => w.savePlan(space, '', '2026-10-01', 'Read', '', 'normal', '1441', ''), /预计用时/);
    assert.throws(() => w.savePlan(space, '', '2026-10-01', 'Read', '', 'normal', '0', ''), /大于 0/);
    assert.throws(() => w.savePlan(space, '', '2026-10-01', 'Read', '', 'normal', '', 'x'.repeat(4001)), /4000/);
    assert.equal(space.plans.length, 0);
  });
  await test('savePlan updates an existing item in place and keeps its status', () => {
    const space = w.newSpace('local'); space.projects.push(project());
    w.savePlan(space, '', '2026-10-01', 'Read', 'p1', 'normal', '', '');
    const id = space.plans[0].id; space.plans[0].status = 'doing';
    w.savePlan(space, id, '2026-10-01', ' Read more ', 'p1', 'important', ' 30 ', ' note ');
    assert.equal(space.plans.length, 1); assert.equal(space.plans[0].title, 'Read more');
    assert.equal(space.plans[0].priority, 'important'); assert.equal(space.plans[0].minutes, 30);
    assert.equal(space.plans[0].note, 'note'); assert.equal(space.plans[0].status, 'doing');
  });
  await test('savePlan refuses to reschedule imported calendar items and unknown ids', () => {
    const space = w.newSpace('local');
    space.plans.push(plan({ id: 'cal', calendarSource: { key: 'k', title: 'Meeting', start: 1, end: 2, allDay: false } }));
    assert.throws(() => w.savePlan(space, 'cal', '2026-10-02', 'Meeting', '', 'normal', '', ''), /日历事项/);
    assert.throws(() => w.savePlan(space, 'gone', '2026-10-01', 'Read', '', 'normal', '', ''), /计划已不存在/);
    assert.equal(space.plans.length, 1);
  });
  await test('removePlan detaches a plan-owned conversation and its link', () => {
    const space = w.newSpace('local'); space.plans.push(plan({ id: 'p1' }));
    const need = w.createNeed(space, 'Read', 'plan', 'p1');
    space.links.push({ kind: 'plan', ownerId: 'p1', needId: need.id }, { kind: 'independent', ownerId: '', needId: need.id });
    w.removePlan(space, 'p1');
    assert.equal(space.plans.length, 0); assert.equal(need.ownerKind, 'independent'); assert.equal(need.ownerId, '');
    assert.equal(space.links.length, 1); assert.equal(space.links[0].kind, 'independent');
    assert.throws(() => w.removePlan(space, 'p1'), /计划已不存在/);
  });
  await test('planSuggestions ranks recent unfinished plans and record todos', () => {
    const space = w.newSpace('local');
    space.plans.push(
      plan({ id: 'a', date: '2026-10-05', title: 'Later' }),
      plan({ id: 'b', date: '2026-10-06', title: 'Doing', status: 'doing' }),
      plan({ id: 'c', date: '2026-10-04', title: 'Done', status: 'done' }),
      plan({ id: 'd', date: '2026-10-03', title: 'Imported', calendarSource: { key: 'k', title: 'I', start: 1, end: 2, allDay: false } }),
      plan({ id: 'e', date: '2026-09-01', title: 'Old' })
    );
    space.records.push(
      record({ id: 'r1', nextTodo: 'Follow up', createdAt: new Date('2026-10-05T08:00').getTime() }),
      record({ id: 'r2', nextTodo: '   ', createdAt: new Date('2026-10-05T09:00').getTime() })
    );
    const suggestions = w.planSuggestions(space, '2026-10-07');
    assert.deepEqual(Array.from(suggestions, item => item.key), ['plan/b', 'plan/a', 'record/r1']);
    assert.match(suggestions[0].reason, /进行中/);
    assert.match(suggestions[1].reason, /未完成/);
    assert.match(suggestions[2].reason, /新增待办/);
    assert.deepEqual(Array.from(w.planSuggestions(space, 'bad')), []);
  });
  await test('planSuggestions skips oversized titles and already adopted keys', () => {
    const space = w.newSpace('local');
    space.plans.push(plan({ id: 'long', date: '2026-10-06', title: 'y'.repeat(201) }));
    assert.deepEqual(Array.from(w.planSuggestions(space, '2026-10-07')), []);
    space.plans.push(plan({ id: 'kept', date: '2026-10-05', title: 'Keep' }));
    assert.deepEqual(Array.from(w.planSuggestions(space, '2026-10-07'), item => item.key), ['plan/kept']);
    space.plans.push(plan({ id: 'adopted', date: '2026-10-07', suggestionKey: 'plan/kept' }));
    assert.deepEqual(Array.from(w.planSuggestions(space, '2026-10-07')), []);
  });
  await test('planSuggestions marks a backfilled record todo as backfilled', () => {
    const space = w.newSpace('local');
    space.records.push(record({ id: 'r9', nextTodo: 'Review', createdAt: new Date('2026-10-05T08:00').getTime(), backfilled: true }));
    const suggestions = w.planSuggestions(space, '2026-10-07');
    assert.equal(suggestions.length, 1); assert.equal(suggestions[0].title, 'Review'); assert.match(suggestions[0].reason, /补记/);
  });
  await test('adoptPlanSuggestion materialises a suggestion exactly once', () => {
    const space = w.newSpace('local');
    space.plans.push(plan({ id: 'src', date: '2026-10-06', title: 'Read' }));
    w.adoptPlanSuggestion(space, '2026-10-07', 'plan/src');
    assert.equal(space.plans.length, 2); assert.equal(space.plans[1].status, 'todo');
    assert.equal(space.plans[1].suggestionKey, 'plan/src'); assert.match(space.plans[1].suggestionReason, /来源计划 src/);
    assert.throws(() => w.adoptPlanSuggestion(space, '2026-10-07', 'plan/src'), /建议已采纳/);
  });
  await test('ownerExists resolves every owner kind and rejects unknown kinds', () => {
    const space = w.newSpace('local');
    space.projects.push(project()); space.plans.push(plan({ id: 'plan1' })); space.books.push(book());
    assert.equal(w.ownerExists(space, 'independent', ''), true);
    assert.equal(w.ownerExists(space, 'project', 'p1'), true);
    assert.equal(w.ownerExists(space, 'plan', 'plan1'), true);
    assert.equal(w.ownerExists(space, 'book', 'b1'), true);
    assert.equal(w.ownerExists(space, 'project', 'missing'), false);
    assert.equal(w.ownerExists(space, 'ghost', ''), false);
  });
  await test('book-owned needs require an existing reading item', () => {
    const space = w.newSpace('local');
    assert.throws(() => w.createNeed(space, 'read', 'book', 'missing'), /归属/);
    space.books.push(book());
    const need = w.createNeed(space, 'read', 'book', 'b1');
    assert.equal(need.ownerKind, 'book'); assert.equal(need.ownerId, 'b1');
  });
  await test('linkedNeed reuses an existing matching conversation before creating one', () => {
    const space = w.newSpace('local'); space.projects.push(project());
    const created = w.createNeed(space, 'Learn', 'project', 'p1');
    const linked = w.linkedNeed(space, 'Learn', 'project', 'p1');
    assert.equal(linked.id, created.id); assert.equal(space.needs.length, 1); assert.equal(space.links.length, 1);
    assert.throws(() => w.linkedNeed(w.newSpace('local'), 'Learn', 'project', 'p1'), /需求来源不存在/);
  });
  await test('moveNeed rejects an unknown conversation and can detach a need from its project', () => {
    const space = w.newSpace('local'); space.projects.push(project());
    assert.throws(() => w.moveNeed(space, 'missing', 'Name', ''), /会话不存在/);
    const need = w.createNeed(space, 'Learn', 'project', 'p1');
    w.moveNeed(space, need.id, 'Detached', '');
    assert.equal(need.ownerKind, 'independent'); assert.equal(need.ownerId, ''); assert.equal(need.name, 'Detached');
  });
  await test('validateRecord rejects non-string notes and invalid timestamps', () => {
    assert.throws(() => w.validateRecord(record({ nextTodo: 5 })), /记录字段无效/);
    assert.throws(() => w.validateRecord(record({ unfinished: 'x'.repeat(4001) })), /记录字段无效/);
    assert.throws(() => w.validateRecord(record({ createdAt: NaN })), /记录时间无效/);
    assert.throws(() => w.validateRecord(record({ backfilled: 'yes' })), /记录时间无效/);
  });
  await test('migration keeps a public HTTP address out of the local workspace', () => {
    const old = d.initialData(); old.notes.push({ id: 'n', text: 'legacy', createdAt: 1 });
    old.settings.baseUrl = 'http://8.8.8.8';
    const data = w.migrateLegacy(old);
    assert.equal(data.connection, null); assert.equal(data.spaces.length, 1);
    assert.equal(w.activeSpace(data).records.length, 1);
  });
  await test('a fully populated workspace validates and keeps its link and run', () => {
    const data = richWorkspace();
    assert.equal(w.validateWorkspace(data), data);
    assert.equal(w.activeSpace(data).links.length, 1);
    assert.equal(w.activeSpace(data).lastSyncAt, 1);
  });
  await test('validateWorkspace rejects unsupported versions, appearance and spaces', () => {
    assert.throws(() => w.validateWorkspace(null), /版本或格式异常/);
    assert.throws(() => w.validateWorkspace({ ...w.newWorkspace(), version: 3 }), /版本或格式异常/);
    assert.throws(() => w.validateWorkspace({ ...w.newWorkspace(), appearance: 3 }), /版本或格式异常/);
    assert.throws(() => w.validateWorkspace({ ...w.newWorkspace(), spaces: null }), /版本或格式异常/);
  });
  await test('validateWorkspace rejects a connection with mistyped switching flags', () => {
    const build = () => { const data = w.newWorkspace(); w.selectConnection(data, connection()); return data; };
    const auto = build(); auto.connection = { ...auto.connection, autoConnect: 'yes' };
    assert.throws(() => w.validateWorkspace(auto), /连接配置损坏/);
    const http = build(); http.connection = { ...http.connection, allowPrivateHttp: 'no' };
    assert.throws(() => w.validateWorkspace(http), /连接配置损坏/);
    const ref = build(); ref.connection = { ...ref.connection, credentialRef: 5 };
    assert.throws(() => w.validateWorkspace(ref), /连接配置损坏/);
    w.validateWorkspace(build());
  });
  await test('validateWorkspace rejects a space whose collections are not arrays', () => {
    const data = w.newWorkspace(); w.activeSpace(data).books = null;
    assert.throws(() => w.validateWorkspace(data), /数据集合损坏/);
  });
  await test('validateWorkspace rejects invalid sync timestamps', () => {
    const zero = w.newWorkspace(); w.activeSpace(zero).lastSyncAt = 0;
    assert.throws(() => w.validateWorkspace(zero), /同步时间无效/);
    const broken = w.newWorkspace(); w.activeSpace(broken).lastSyncAt = NaN;
    assert.throws(() => w.validateWorkspace(broken), /同步时间无效/);
  });
  await test('validateWorkspace rejects invalid project ownership metadata', () => {
    const managed = w.newWorkspace(); w.activeSpace(managed).projects.push({ ...project(), managedBy: 'robot' });
    assert.throws(() => w.validateWorkspace(managed), /项目托管信息无效/);
    const step = w.newWorkspace(); w.activeSpace(step).projects.push({ ...project(), nextStep: 5 });
    assert.throws(() => w.validateWorkspace(step), /项目托管信息无效/);
  });
  await test('validateWorkspace rejects invalid plan detail fields', () => {
    const reject = patch => {
      const data = w.newWorkspace(); w.activeSpace(data).plans.push({ ...plan(), ...patch });
      assert.throws(() => w.validateWorkspace(data), /计划详情格式无效/);
    };
    reject({ priority: 'urgent' }); reject({ minutes: -1 }); reject({ minutes: 1.5 }); reject({ minutes: 1441 });
    reject({ note: 5 }); reject({ note: 'x'.repeat(4001) });
    reject({ suggestionKey: 5 }); reject({ suggestionKey: 'x'.repeat(201) });
    reject({ suggestionReason: 5 }); reject({ suggestionReason: 'x'.repeat(1001) });
  });
  await test('validateWorkspace rejects plans with dangling projects or invalid status and date', () => {
    const build = overrides => { const data = w.newWorkspace(); w.activeSpace(data).plans.push(plan(overrides)); return data; };
    assert.throws(() => w.validateWorkspace(build({ projectId: 'missing' })), /计划格式无效/);
    assert.throws(() => w.validateWorkspace(build({ status: 'later' })), /计划格式无效/);
    assert.throws(() => w.validateWorkspace(build({ date: '2026-02-30' })), /计划格式无效/);
  });
  await test('validateWorkspace rejects conversations with invalid ownership or history', () => {
    const build = () => {
      const data = w.newWorkspace(); const space = w.activeSpace(data);
      space.projects.push(project());
      const need = w.createNeed(space, 'Learn', 'project', 'p1');
      need.messages.push({ role: 'user', content: 'hello' });
      return { data, need };
    };
    const owner = build(); owner.need.ownerId = 'absent';
    assert.throws(() => w.validateWorkspace(owner.data), /会话归属或历史无效/);
    const time = build(); time.need.createdAt = NaN;
    assert.throws(() => w.validateWorkspace(time.data), /会话归属或历史无效/);
    const history = build(); history.need.messages = null;
    assert.throws(() => w.validateWorkspace(history.data), /会话归属或历史无效/);
    const injected = build(); injected.need.messages.push({ role: 'system', content: 'x' });
    assert.throws(() => w.validateWorkspace(injected.data), /消息格式无效/);
  });
  await test('validateWorkspace rejects reading statistics outside their contract', () => {
    const build = patch => withSpace(space => space.books.push({ ...book(), ...patch }));
    assert.throws(() => w.validateWorkspace(build({ progress: 5 })), /阅读数据/);
    assert.throws(() => w.validateWorkspace(build({ updatedAt: 0 })), /阅读数据/);
    assert.throws(() => w.validateWorkspace(build({ updatedAt: NaN })), /阅读数据/);
    assert.throws(() => w.validateWorkspace(build({ excerpts: null })), /阅读数据/);
    assert.throws(() => w.validateWorkspace(build({ summaries: null })), /阅读数据/);
    assert.throws(() => w.validateWorkspace(build({ notes: -1 })), /阅读数据/);
    assert.throws(() => w.validateWorkspace(build({ highlights: 1.5 })), /阅读数据/);
    w.validateWorkspace(build({ progress: '10%', notes: 0, highlights: 2, thoughts: 1, weeklySummaries: 3 }));
  });
  await test('validateWorkspace rejects agent runs that lose their conversation', () => {
    const build = patch => withSpace(space => {
      const need = w.createNeed(space, 'Run', 'independent', '');
      space.runs.push({ id: 'run1', needId: need.id, status: 'ok', updatedAt: 1, events: [], artifacts: [], deployment: 'local', ...patch });
    });
    assert.throws(() => w.validateWorkspace(build({ needId: 'missing' })), /运行关联无效/);
    assert.throws(() => w.validateWorkspace(build({ events: null })), /运行关联无效/);
    assert.throws(() => w.validateWorkspace(build({ artifacts: null })), /运行关联无效/);
    assert.throws(() => w.validateWorkspace(build({ updatedAt: NaN })), /运行关联无效/);
    assert.throws(() => w.validateWorkspace(build({ status: 5 })), /运行关联无效/);
    assert.throws(() => w.validateWorkspace(build({ deployment: 5 })), /运行关联无效/);
    w.validateWorkspace(build({}));
  });
  await test('validateWorkspace rejects reminder records outside the first-release limits', () => {
    const data = w.newWorkspace();
    w.activeSpace(data).reminders.push({ id: 't', title: 'Read', time: '08:30', weekdays: false, reminderId: -1 });
    assert.throws(() => w.validateWorkspace(data), /提醒记录损坏/);
  });
  await test('planSuggestions uses the event interval date of a timed record', () => {
    const space = w.newSpace('local');
    const start = new Date('2026-10-05T09:00').getTime();
    space.records.push(
      record({ id: 'r1', nextTodo: 'First', start, end: start + 3600000, createdAt: start }),
      record({ id: 'r2', nextTodo: 'Second', start: start + 60000, end: start + 120000, createdAt: start + 60000 })
    );
    const suggestions = w.planSuggestions(space, '2026-10-07');
    assert.deepEqual(Array.from(suggestions, item => item.key), ['record/r2', 'record/r1']);
    assert.match(suggestions[0].reason, /新增待办/);
  });
  await test('connectionUrl rejects an unsupported protocol and a relative API path', () => {
    assert.throws(() => w.connectionUrl({ ...connection(), protocol: 'ftp' }), /协议/);
    assert.throws(() => w.connectionUrl({ ...connection(), basePath: 'api' }), /API 路径/);
  });
  await test('validateWorkspace rejects a link whose owner or conversation is gone', () => {
    const owner = withSpace(space => space.links.push({ kind: 'project', ownerId: 'missing', needId: 'nope' }));
    assert.throws(() => w.validateWorkspace(owner), /原始需求关联损坏/);
    const need = withSpace(space => {
      space.projects.push(project());
      space.links.push({ kind: 'project', ownerId: 'p1', needId: 'nope' });
    });
    assert.throws(() => w.validateWorkspace(need), /原始需求关联损坏/);
  });
  await test('ProjectDraft starts as an empty manual learning draft', () => {
    const draft = new w.ProjectDraft();
    assert.equal(draft.name, ''); assert.equal(draft.goal, ''); assert.equal(draft.managedBy, 'manual');
    assert.equal(draft.kind, 'learning'); assert.equal(draft.criteria, ''); assert.equal(draft.targetDate, '');
    assert.equal(draft.nextStep, ''); assert.equal(draft.milestoneTitle, ''); assert.equal(draft.milestoneDate, '');
    assert.equal(draft.review, '');
  });
  await test('validateProjectDetails accepts every kind and status and rejects unknown values', () => {
    ['learning', 'fitness', 'effectiveness', 'software', 'other'].forEach(kind => w.validateProjectDetails(projectDetails({ kind })));
    w.validateProjectDetails(projectDetails({ kind: undefined }));
    assert.throws(() => w.validateProjectDetails(projectDetails({ kind: 'hobby' })), /项目类型或状态无效/);
    ['active', 'paused', 'completed', 'archived'].forEach(status => w.validateProjectDetails(projectDetails({ status })));
    w.validateProjectDetails(projectDetails({ status: undefined }));
    assert.throws(() => w.validateProjectDetails(projectDetails({ status: 'later' })), /项目类型或状态无效/);
  });
  await test('validateProjectDetails bounds the completion standard and the next step', () => {
    w.validateProjectDetails(projectDetails({ criteria: undefined, nextStep: 'x'.repeat(4000) }));
    w.validateProjectDetails(projectDetails({ criteria: 'x'.repeat(4000) }));
    assert.throws(() => w.validateProjectDetails(projectDetails({ criteria: 5 })), /完成标准、下一步或目标日期无效/);
    assert.throws(() => w.validateProjectDetails(projectDetails({ criteria: 'x'.repeat(4001) })), /完成标准、下一步或目标日期无效/);
    assert.throws(() => w.validateProjectDetails(projectDetails({ nextStep: 'x'.repeat(4001) })), /完成标准、下一步或目标日期无效/);
  });
  await test('validateProjectDetails allows a blank or past target date and rejects malformed ones', () => {
    w.validateProjectDetails(projectDetails({ targetDate: undefined }));
    w.validateProjectDetails(projectDetails({ targetDate: '' }));
    w.validateProjectDetails(projectDetails({ targetDate: '2020-01-01' }));
    assert.throws(() => w.validateProjectDetails(projectDetails({ targetDate: '2026-02-30' })), /完成标准、下一步或目标日期无效/);
    assert.throws(() => w.validateProjectDetails(projectDetails({ targetDate: '31/12/2026' })), /完成标准、下一步或目标日期无效/);
  });
  await test('validateProjectDetails bounds the milestone list and every milestone', () => {
    const many = count => Array.from({ length: count }, (_, index) => milestone({ id: 'm' + index }));
    w.validateProjectDetails(projectDetails({ milestones: undefined }));
    w.validateProjectDetails(projectDetails({ milestones: many(100) }));
    assert.throws(() => w.validateProjectDetails(projectDetails({ milestones: null })), /项目里程碑格式无效或超过 100 项/);
    assert.throws(() => w.validateProjectDetails(projectDetails({ milestones: many(101) })), /项目里程碑格式无效或超过 100 项/);
    w.validateProjectDetails(projectDetails({ milestones: [milestone({ title: '  Step  ', dueDate: '2026-01-01' })] }));
    assert.throws(() => w.validateProjectDetails(projectDetails({ milestones: [milestone({ title: '   ' })] })), /请先输入内容/);
    assert.throws(() => w.validateProjectDetails(projectDetails({ milestones: [milestone({ title: 'x'.repeat(201) })] })), /200/);
    assert.throws(() => w.validateProjectDetails(projectDetails({ milestones: [milestone({ done: 'yes' })] })), /里程碑日期或状态无效/);
    assert.throws(() => w.validateProjectDetails(projectDetails({ milestones: [milestone({ dueDate: '2026-02-30' })] })), /里程碑日期或状态无效/);
    assert.throws(() => w.validateProjectDetails(projectDetails({ milestones: [milestone(), milestone()] })), /重复或无效标识/);
  });
  await test('validateProjectDetails bounds the review list and every review', () => {
    w.validateProjectDetails(projectDetails({ reviews: undefined }));
    w.validateProjectDetails(projectDetails({ reviews: [review({ text: '  Note  ' })] }));
    assert.throws(() => w.validateProjectDetails(projectDetails({ reviews: null })), /项目复盘格式无效/);
    assert.throws(() => w.validateProjectDetails(projectDetails({ reviews: [review({ text: '   ' })] })), /请先输入内容/);
    assert.throws(() => w.validateProjectDetails(projectDetails({ reviews: [review({ text: 'x'.repeat(4001) })] })), /4000/);
    assert.throws(() => w.validateProjectDetails(projectDetails({ reviews: [review({ createdAt: 0 })] })), /复盘时间无效/);
    assert.throws(() => w.validateProjectDetails(projectDetails({ reviews: [review({ createdAt: NaN })] })), /复盘时间无效/);
    assert.throws(() => w.validateProjectDetails(projectDetails({ reviews: [review(), review()] })), /重复或无效标识/);
  });
  await test('projectKindLabel maps every kind and falls back to other', () => {
    assert.equal(w.projectKindLabel('learning'), '学习成长');
    assert.equal(w.projectKindLabel('fitness'), '健身运动');
    assert.equal(w.projectKindLabel('effectiveness'), '效能提升');
    assert.equal(w.projectKindLabel('software'), '软件构建');
    assert.equal(w.projectKindLabel('other'), '其他');
    assert.equal(w.projectKindLabel('unknown'), '其他');
    assert.equal(w.projectKindLabel(), '其他');
  });
  await test('projectStatusLabel maps every status and falls back to active', () => {
    assert.equal(w.projectStatusLabel('active'), '进行中');
    assert.equal(w.projectStatusLabel('paused'), '已暂停');
    assert.equal(w.projectStatusLabel('completed'), '已达成');
    assert.equal(w.projectStatusLabel('archived'), '已归档');
    assert.equal(w.projectStatusLabel('unknown'), '进行中');
    assert.equal(w.projectStatusLabel(), '进行中');
  });
  await test('projectDraft copies editable fields without milestones or reviews', () => {
    const empty = w.projectDraft();
    assert.equal(empty.name, ''); assert.equal(empty.goal, ''); assert.equal(empty.managedBy, 'manual');
    assert.equal(empty.kind, 'learning'); assert.equal(empty.criteria, ''); assert.equal(empty.targetDate, '');
    assert.equal(empty.nextStep, '');
    const source = projectDetails({ name: 'Ship', goal: 'Goal', managedBy: 'agent', kind: 'software', criteria: 'Done',
      targetDate: '2026-06-30', nextStep: 'Draft', milestones: [milestone()], reviews: [review()] });
    const copied = w.projectDraft(source);
    assert.equal(copied.name, 'Ship'); assert.equal(copied.goal, 'Goal'); assert.equal(copied.managedBy, 'agent');
    assert.equal(copied.kind, 'software'); assert.equal(copied.criteria, 'Done'); assert.equal(copied.targetDate, '2026-06-30');
    assert.equal(copied.nextStep, 'Draft');
    assert.equal('milestones' in copied, false); assert.equal('reviews' in copied, false);
    const legacy = w.projectDraft(project());
    assert.equal(legacy.kind, 'other'); assert.equal(legacy.criteria, ''); assert.equal(legacy.targetDate, '');
    assert.equal(legacy.nextStep, '');
  });
  await test('saveProject creates a project with trimmed fields and empty lifecycle arrays', () => {
    const data = w.newWorkspace(); const space = w.activeSpace(data);
    const id = w.saveProject(space, '', newDraft({ name: '  Learn  ', goal: '  Understand  ', criteria: '  Explain  ',
      targetDate: ' 2026-12-31 ', nextStep: '  Read  ', kind: 'fitness' }));
    assert.equal(space.projects.length, 1);
    const created = space.projects[0];
    assert.equal(created.id, id); assert.ok(id.length > 0);
    assert.equal(created.name, 'Learn'); assert.equal(created.goal, 'Understand'); assert.equal(created.criteria, 'Explain');
    assert.equal(created.targetDate, '2026-12-31'); assert.equal(created.nextStep, 'Read'); assert.equal(created.kind, 'fitness');
    assert.equal(created.managedBy, 'manual'); assert.equal(created.status, 'active');
    assert.deepEqual(Array.from(created.milestones), []); assert.deepEqual(Array.from(created.reviews), []);
    assert.equal(w.validateWorkspace(data), data);
  });
  await test('saveProject accepts an agent-managed project with a past target date', () => {
    const space = w.newSpace('local');
    const id = w.saveProject(space, '', newDraft({ name: 'Backfill', goal: 'Goal', criteria: 'Done', targetDate: '2020-01-01', managedBy: 'agent' }));
    assert.equal(space.projects[0].id, id); assert.equal(space.projects[0].targetDate, '2020-01-01');
    assert.equal(space.projects[0].managedBy, 'agent');
  });
  await test('saveProject rejects blank, oversized or invalid required fields before writing', () => {
    const space = w.newSpace('local');
    assert.throws(() => w.saveProject(space, '', newDraft({ name: '   ' })), /请先输入内容/);
    assert.throws(() => w.saveProject(space, '', newDraft({ name: 'x'.repeat(101) })), /100/);
    assert.throws(() => w.saveProject(space, '', newDraft({ goal: '   ' })), /请先输入内容/);
    assert.throws(() => w.saveProject(space, '', newDraft({ criteria: '' })), /请先输入内容/);
    assert.throws(() => w.saveProject(space, '', newDraft({ managedBy: 'robot' })), /托管方式无效/);
    assert.throws(() => w.saveProject(space, '', newDraft({ kind: 'hobby' })), /项目类型或状态无效/);
    assert.throws(() => w.saveProject(space, '', newDraft({ targetDate: '2026-02-30' })), /目标日期无效/);
    assert.throws(() => w.saveProject(space, '', newDraft({ nextStep: 'x'.repeat(4001) })), /下一步/);
    assert.equal(space.projects.length, 0);
  });
  await test('saveProject updates a project in place and preserves id, status, milestones and reviews', () => {
    const space = w.newSpace('local');
    const id = w.saveProject(space, '', newDraft());
    const original = space.projects[0];
    original.status = 'paused'; original.milestones = [milestone()]; original.reviews = [review()];
    assert.equal(w.saveProject(space, id, newDraft({ name: '  Renamed  ', goal: 'Goal 2', criteria: 'Done 2',
      kind: 'software', managedBy: 'agent', nextStep: '  Step  ' })), id);
    assert.equal(space.projects.length, 1);
    const updated = space.projects[0];
    assert.equal(updated.id, id); assert.equal(updated.status, 'paused');
    assert.equal(updated.milestones.length, 1); assert.equal(updated.reviews.length, 1);
    assert.equal(updated.name, 'Renamed'); assert.equal(updated.goal, 'Goal 2'); assert.equal(updated.criteria, 'Done 2');
    assert.equal(updated.kind, 'software'); assert.equal(updated.managedBy, 'agent'); assert.equal(updated.nextStep, 'Step');
  });
  await test('saveProject defaults an updated legacy project back to active with empty lifecycle arrays', () => {
    const space = w.newSpace('local'); space.projects.push(project());
    assert.equal(w.saveProject(space, 'p1', newDraft()), 'p1');
    assert.equal(space.projects[0].status, 'active');
    assert.deepEqual(Array.from(space.projects[0].milestones), []); assert.deepEqual(Array.from(space.projects[0].reviews), []);
  });
  await test('saveProject refuses an unknown id and an archived project', () => {
    const space = w.newSpace('local');
    assert.throws(() => w.saveProject(space, 'missing', newDraft()), /项目已不存在/);
    const id = w.saveProject(space, '', newDraft());
    space.projects[0].status = 'archived';
    assert.throws(() => w.saveProject(space, id, newDraft({ name: 'Changed' })), /请先恢复已归档项目/);
    assert.equal(space.projects[0].name, 'Learn');
  });
  await test('changeProjectStatus rejects unknown projects and invalid target states', () => {
    const space = w.newSpace('local');
    assert.throws(() => w.changeProjectStatus(space, 'missing', 'active', ''), /项目已不存在/);
    const id = w.saveProject(space, '', newDraft());
    assert.throws(() => w.changeProjectStatus(space, id, 'later', ''), /项目状态无效/);
    assert.equal(space.projects[0].status, 'active');
  });
  await test('changeProjectStatus pauses, resumes and archives and refuses writes after archiving', () => {
    const space = w.newSpace('local');
    const id = w.saveProject(space, '', newDraft());
    w.changeProjectStatus(space, id, 'paused', ''); assert.equal(space.projects[0].status, 'paused');
    w.changeProjectStatus(space, id, 'active', ''); assert.equal(space.projects[0].status, 'active');
    w.changeProjectStatus(space, id, 'archived', ''); assert.equal(space.projects[0].status, 'archived');
    assert.throws(() => w.changeProjectStatus(space, id, 'paused', ''), /请先恢复已归档项目/);
    assert.throws(() => w.changeProjectStatus(space, id, 'completed', ''), /请先恢复已归档项目/);
    w.changeProjectStatus(space, id, 'active', ''); assert.equal(space.projects[0].status, 'active');
  });
  await test('project lifecycle refuses unspecified transitions and duplicate completion evidence', () => {
    const space = w.newSpace('local'); const id = w.saveProject(space, '', newDraft());
    w.changeProjectStatus(space, id, 'active', '');
    w.changeProjectStatus(space, id, 'paused', '');
    assert.throws(() => w.changeProjectStatus(space, id, 'completed', 'evidence'), /请先重新推进/);
    w.changeProjectStatus(space, id, 'active', ''); w.changeProjectStatus(space, id, 'completed', 'evidence');
    assert.throws(() => w.changeProjectStatus(space, id, 'paused', ''), /请先重新推进/);
    w.changeProjectStatus(space, id, 'completed', 'duplicate'); assert.equal(space.projects[0].reviews.length, 1);
    space.projects[0].status = undefined; w.changeProjectStatus(space, id, 'paused', '');
    assert.equal(space.projects[0].status, 'paused');
  });
  await test('changeProjectStatus completing records trimmed evidence in a new review', () => {
    const space = w.newSpace('local');
    const id = w.saveProject(space, '', newDraft());
    const before = Date.now();
    w.changeProjectStatus(space, id, 'completed', '  passed every check  ');
    const project = space.projects[0];
    assert.equal(project.status, 'completed'); assert.equal(project.reviews.length, 1);
    assert.equal(project.reviews[0].text, '目标达成依据：passed every check');
    assert.ok(project.reviews[0].id.length > 0);
    assert.ok(project.reviews[0].createdAt > 0 && project.reviews[0].createdAt >= before);
    w.changeProjectStatus(space, id, 'active', '');
    assert.equal(project.status, 'active'); assert.equal(project.reviews.length, 1);
  });
  await test('changeProjectStatus completing initialises a missing review list', () => {
    const space = w.newSpace('local');
    const id = w.saveProject(space, '', newDraft());
    space.projects[0].reviews = undefined;
    w.changeProjectStatus(space, id, 'completed', 'evidence');
    assert.equal(space.projects[0].reviews.length, 1);
  });
  await test('changeProjectStatus completing requires a standard and bounded evidence', () => {
    const space = w.newSpace('local');
    const id = w.saveProject(space, '', newDraft());
    space.projects[0].criteria = '   ';
    assert.throws(() => w.changeProjectStatus(space, id, 'completed', 'evidence'), /请先填写完成标准/);
    assert.equal(space.projects[0].status, 'active');
    space.projects[0].criteria = undefined;
    assert.throws(() => w.changeProjectStatus(space, id, 'completed', 'evidence'), /请先填写完成标准/);
    space.projects[0].criteria = 'Explain it';
    assert.throws(() => w.changeProjectStatus(space, id, 'completed', 'x'.repeat(3901)), /3900/);
    assert.equal(space.projects[0].reviews.length, 0);
  });
  await test('addProjectMilestone validates the title and due date before appending', () => {
    const space = w.newSpace('local');
    const id = w.saveProject(space, '', newDraft());
    assert.throws(() => w.addProjectMilestone(space, 'missing', 'Step', ''), /项目已不存在/);
    assert.throws(() => w.addProjectMilestone(space, id, '   ', ''), /请先输入内容/);
    assert.throws(() => w.addProjectMilestone(space, id, 'x'.repeat(201), ''), /200/);
    assert.throws(() => w.addProjectMilestone(space, id, 'Step', '2026-02-30'), /里程碑日期请填写 YYYY-MM-DD/);
    assert.equal(space.projects[0].milestones.length, 0);
    w.addProjectMilestone(space, id, '  Read  ', '');
    w.addProjectMilestone(space, id, 'Ship', ' 2026-12-31 ');
    const items = space.projects[0].milestones;
    assert.equal(items.length, 2);
    assert.equal(items[0].title, 'Read'); assert.equal(items[0].dueDate, ''); assert.equal(items[0].done, false);
    assert.equal(items[1].title, 'Ship'); assert.equal(items[1].dueDate, '2026-12-31');
    assert.notEqual(items[0].id, items[1].id);
  });
  await test('addProjectMilestone initialises a missing list and refuses archived or full projects', () => {
    const space = w.newSpace('local');
    const id = w.saveProject(space, '', newDraft());
    space.projects[0].milestones = undefined;
    w.addProjectMilestone(space, id, 'First', '');
    assert.equal(space.projects[0].milestones.length, 1);
    space.projects[0].milestones = Array.from({ length: 100 }, (_, index) => milestone({ id: 'm' + index }));
    assert.throws(() => w.addProjectMilestone(space, id, 'Overflow', ''), /最多 100 项里程碑/);
    assert.equal(space.projects[0].milestones.length, 100);
    space.projects[0].milestones = Array.from({ length: 99 }, (_, index) => milestone({ id: 'm' + index }));
    w.addProjectMilestone(space, id, 'Last', '');
    assert.equal(space.projects[0].milestones.length, 100);
    space.projects[0].status = 'archived';
    assert.throws(() => w.addProjectMilestone(space, id, 'Blocked', ''), /请先恢复已归档项目/);
  });
  await test('setProjectMilestone toggles completion and rejects missing milestones', () => {
    const space = w.newSpace('local');
    const id = w.saveProject(space, '', newDraft());
    assert.throws(() => w.setProjectMilestone(space, 'missing', 'm1', true), /项目已不存在/);
    space.projects[0].milestones = undefined;
    assert.throws(() => w.setProjectMilestone(space, id, 'm1', true), /里程碑已不存在/);
    w.addProjectMilestone(space, id, 'Step', '');
    const milestoneId = space.projects[0].milestones[0].id;
    w.setProjectMilestone(space, id, milestoneId, true);
    assert.equal(space.projects[0].milestones[0].done, true);
    w.setProjectMilestone(space, id, milestoneId, false);
    assert.equal(space.projects[0].milestones[0].done, false);
    space.projects[0].status = 'archived';
    assert.throws(() => w.setProjectMilestone(space, id, milestoneId, true), /请先恢复已归档项目/);
  });
  await test('addProjectReview appends trimmed text with a positive timestamp', () => {
    const space = w.newSpace('local');
    const id = w.saveProject(space, '', newDraft());
    const before = Date.now();
    w.addProjectReview(space, id, '  first note  ');
    const items = space.projects[0].reviews;
    assert.equal(items.length, 1); assert.equal(items[0].text, 'first note');
    assert.ok(items[0].id.length > 0); assert.ok(items[0].createdAt > 0 && items[0].createdAt >= before);
    space.projects[0].reviews = undefined;
    w.addProjectReview(space, id, 'after reset');
    assert.equal(space.projects[0].reviews.length, 1); assert.equal(space.projects[0].reviews[0].text, 'after reset');
  });
  await test('addProjectReview rejects blank text, unknown ids, oversized text and archived projects', () => {
    const space = w.newSpace('local');
    const id = w.saveProject(space, '', newDraft());
    assert.throws(() => w.addProjectReview(space, 'missing', 'note'), /项目已不存在/);
    assert.throws(() => w.addProjectReview(space, id, '   '), /请先输入内容/);
    assert.throws(() => w.addProjectReview(space, id, 'x'.repeat(4001)), /4000/);
    assert.equal(space.projects[0].reviews.length, 0);
    space.projects[0].status = 'archived';
    assert.throws(() => w.addProjectReview(space, id, 'blocked'), /请先恢复已归档项目/);
  });
  await test('projectBrief states missing criteria, date, next step and milestones explicitly', () => {
    const brief = w.projectBrief(project());
    assert.match(brief, /项目：Learn/); assert.match(brief, /类型：其他/); assert.match(brief, /状态：进行中/);
    assert.match(brief, /目标：Understand/); assert.match(brief, /完成标准：待明确/);
    assert.match(brief, /目标日期：未设定/); assert.match(brief, /下一步：待讨论/);
    assert.match(brief, /里程碑：\n尚未制定/);
  });
  await test('projectBrief lists milestone state and due date in order', () => {
    const brief = w.projectBrief(projectDetails({ kind: 'software', status: 'paused', criteria: 'Reviewable',
      targetDate: '2026-12-31', nextStep: 'Ship it',
      milestones: [milestone({ id: 'm1', title: 'Design', dueDate: '2026-11-01', done: true }),
        milestone({ id: 'm2', title: 'Build', dueDate: '', done: false })] }));
    assert.match(brief, /类型：软件构建/); assert.match(brief, /状态：已暂停/);
    assert.match(brief, /完成标准：Reviewable/); assert.match(brief, /目标日期：2026-12-31/);
    assert.match(brief, /下一步：Ship it/);
    assert.match(brief, /已完成：Design（2026-11-01）/); assert.match(brief, /待完成：Build/);
    assert.ok(!brief.includes('待完成：Build（'));
  });
  await test('projectBrief truncates an oversized summary with an explicit marker', () => {
    const brief = w.projectBrief(projectDetails({ goal: 'g'.repeat(4000), criteria: 'c'.repeat(4000) }));
    assert.equal(brief.length, 3833);
    assert.ok(brief.length <= 3900);
    assert.ok(brief.endsWith('请编辑并补充本次需要讨论的部分。）'));
    assert.match(brief, /此摘要已截短/);
  });
  await test('validateWorkspace accepts projects with the new fields and legacy projects', () => {
    const data = w.newWorkspace(); const space = w.activeSpace(data);
    space.projects.push(projectDetails({ milestones: [milestone({ id: 'm1', dueDate: '2026-01-01' })],
      reviews: [review({ id: 'v1', createdAt: Date.now() })] }));
    space.projects.push(project('legacy'));
    assert.equal(w.validateWorkspace(data), data);
    assert.equal(space.projects.length, 2);
  });
  await test('validateWorkspace rejects a project whose milestone or review identifiers repeat', () => {
    const duplicateMilestone = w.newWorkspace();
    w.activeSpace(duplicateMilestone).projects.push(projectDetails({ milestones: [milestone(), milestone()] }));
    assert.throws(() => w.validateWorkspace(duplicateMilestone), /重复或无效标识/);
    const duplicateReview = w.newWorkspace();
    w.activeSpace(duplicateReview).projects.push(projectDetails({ reviews: [review(), review()] }));
    assert.throws(() => w.validateWorkspace(duplicateReview), /重复或无效标识/);
    const badKind = w.newWorkspace();
    w.activeSpace(badKind).projects.push(projectDetails({ kind: 'hobby' }));
    assert.throws(() => w.validateWorkspace(badKind), /项目类型或状态无效/);
  });
  console.log(`\n${passed} V1 workspace tests passed; platform APIs injected, not device acceptance.`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
