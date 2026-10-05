const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { loadTypescript } = require('./lib/deveco-env.cjs');
const ts = loadTypescript();
function load(relative, imports = {}) {
  const source = fs.readFileSync(path.join(__dirname, '../entry/src/main/ets', relative), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2021, module: ts.ModuleKind.CommonJS } });
  const sandbox = { exports: {}, require(name) { if (!(name in imports)) throw Error('Unexpected import ' + name); return imports[name]; } };
  vm.runInNewContext(output.outputText, sandbox);
  return sandbox.exports;
}
const d = load('core/Domain.ts');
const w = load('core/Workspace.ts', { './Domain': d });
let passed = 0;
async function test(name, action) { await action(); passed++; console.log('PASS ' + name); }
function connection(host = 'example.org') {
  return { name: 'Home', host, protocol: 'https', port: 443, basePath: '', model: 'hermes-agent', allowPrivateHttp: false, autoConnect: false, credentialRef: 'secure-ref' };
}
function project(id = 'p1') { return { id, name: 'Learn', goal: 'Understand', managedBy: 'manual', nextStep: '' }; }
function record(overrides = {}) { return { id: 'r1', text: 'Learned something', unfinished: '', energy: '', decision: '', nextTodo: '', start: null, end: null, createdAt: Date.now(), backfilled: false, ...overrides }; }

function sendHarness() {
  const page = fs.readFileSync(path.join(__dirname, '../entry/src/main/ets/pages/Index.ets'), 'utf8');
  const method = page.slice(page.indexOf('  private async send()'), page.indexOf('  private async refreshCalendar()'));
  const compiled = ts.transpileModule('class Harness {' + method + '} exports.Harness = Harness;', {
    compilerOptions: { target: ts.ScriptTarget.ES2021, module: ts.ModuleKind.CommonJS }
  }).outputText;
  const sandbox = { exports: {}, copyWorkspace: w.copyWorkspace, activeSpace: w.activeSpace,
    serverKey: w.serverKey, createRequest: d.createRequest };
  vm.runInNewContext(compiled, sandbox);
  const h = new sandbox.exports.Harness();
  h.data = w.newWorkspace(); w.selectConnection(h.data, connection());
  const need = w.createNeed(w.activeSpace(h.data), 'Chat', 'independent', '');
  h.ready = true; h.busy = false; h.chatDraft = 'hello'; h.drafts = new Map();
  h.routeKey = () => 'server/chat'; h.selectedNeed = () => w.activeSpace(h.data).needs.find(n => n.id === need.id);
  h.sharePreview = () => ''; h.settings = () => ({}); h.notice = () => {};
  h.credentials = { read: async () => 'test-token' }; h.repository = { save: async () => {} };
  return h;
}
async function main() {
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
  await test('daily counts distinguish dates and explicit statuses', () => {
    const space = w.newSpace('local');
    space.plans = ['todo', 'doing', 'done'].map((status, i) => ({ id: String(i), date: '2026-10-01', title: status, status, projectId: '' }));
    space.plans.push({ id: 'other', date: '2026-10-02', title: 'other', status: 'done', projectId: '' });
    assert.deepEqual(Array.from(w.planCounts(space, '2026-10-01')), [1, 1, 1]);
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
    // Emulator regression (docs/10): the chat page went stale because it kept rendering the pre-send object.
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
    const sandbox = { exports: {} };
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
  await test('chat page renders live messages with the pending bubble below history', () => {
    const page = fs.readFileSync(path.join(__dirname, '../entry/src/main/ets/pages/Index.ets'), 'utf8');
    const messages = page.indexOf('ForEach(this.selectedNeed()?.messages ?? []');
    const pending = page.indexOf('if (this.pendingKey === this.routeKey())');
    const input = page.indexOf("this.area('继续这个需求'");
    assert.ok(messages > 0 && pending > messages && input > pending);
  });
  await test('operation feedback uses toast without a residual top banner', () => {
    const page = fs.readFileSync(path.join(__dirname, '../entry/src/main/ets/pages/Index.ets'), 'utf8');
    assert.ok(page.includes('showToast'));
    assert.ok(!page.includes('@State feedback'));
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
  console.log(`\n${passed} V1 workspace tests passed; platform APIs injected, not device acceptance.`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
