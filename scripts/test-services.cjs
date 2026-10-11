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
let passed = 0;
async function test(name, action) { await action(); passed++; console.log('PASS ' + name); }
async function main() {
  await test('message links open only on explicit action, reject credentials and sanitize native failures', async () => {
    const presentation = load('services/SystemPresentation.ets', { '@kit.AbilityKit': { ConfigurationConstant: {} } });
    const opened = [];
    await presentation.openExternalLink({ startAbility: async want => opened.push(want) }, 'https://example.org/source');
    assert.equal(opened.length, 1); assert.equal(opened[0].uri, 'https://example.org/source');
    for (const url of ['javascript:alert(1)', 'https://token@example.org/a', 'https://example.org/ bad']) {
      await assert.rejects(() => presentation.openExternalLink({ startAbility: async want => opened.push(want) }, url), /链接地址无效/);
    }
    assert.equal(opened.length, 1);
    await assert.rejects(() => presentation.openExternalLink({ startAbility: async () => { throw Error('private native details'); } }, 'https://example.org'), error => {
      assert.match(error.message, /网页打开失败/); assert.ok(!error.message.includes('private native details')); return true;
    });
  });
  let requestOptions, requestUrl, destroyed = 0, calls = 0, fail = false;
  const http = {
    RequestMethod: { POST: 'POST', GET: 'GET' }, HttpDataType: { STRING: 'STRING' },
    createHttp() { return {
      async request(url, options) {
        calls++; requestUrl = url; requestOptions = options;
        if (fail) throw Error('socket secret details');
        return { responseCode: 200, result: '{"choices":[{"message":{"content":"reply"}}]}' };
      }, destroy() { destroyed++; }
    }; }
  };
  const Client = load('services/HermesClient.ets', { '@kit.NetworkKit': { http }, '../core/Domain': domain, '../core/Workspace': load('core/Workspace.ts', { './Domain': domain, './Reading': load('core/Reading.ts') }) }).HermesClient;
  const client = new Client();
  const settings = { baseUrl: 'https://example.org', model: 'hermes-agent', allowLocalHttp: false };
  const request = domain.createRequest('hermes-agent', [], 'hello', '');
  await test('HTTP adapter uses expected endpoint, bearer, and disables redirects', async () => {
    assert.equal(await client.chat(settings, 'temporary-token', request), 'reply');
    assert.equal(requestUrl, 'https://example.org/v1/chat/completions');
    assert.equal(requestOptions.header.Authorization, 'Bearer temporary-token');
    assert.equal(requestOptions.maxRedirects, 0); assert.equal(requestOptions.usingCache, false);
    assert.equal(destroyed, 1);
  });
  await test('transport failure is sanitized, cleaned up, and never auto-retried', async () => {
    fail = true;
    await assert.rejects(() => client.chat(settings, 'temporary-token', request), /可能仍在执行/);
    assert.equal(calls, 2); assert.equal(destroyed, 2);
    fail = false;
  });
  await test('missing credentials cause no network operation', async () => {
    await assert.rejects(() => client.chat(settings, '', request), /Token/);
    assert.equal(calls, 2);
  });
  await test('stopped request discards a late reply and releases the transport once', async () => {
    let finish, released = 0;
    const transport = { ...http, createHttp() { return {
      request() { return new Promise(resolve => { finish = resolve; }); },
      destroy() { released++; }
    }; } };
    const Stoppable = load('services/HermesClient.ets', {
      '@kit.NetworkKit': { http: transport }, '../core/Domain': domain, '../core/Workspace': load('core/Workspace.ts', { './Domain': domain, './Reading': load('core/Reading.ts') })
    }).HermesClient;
    const stoppedClient = new Stoppable();
    const pending = stoppedClient.chat(settings, 'temporary-token', request);
    stoppedClient.stop(); stoppedClient.stop();
    finish({ responseCode: 200, result: '{"choices":[{"message":{"content":"late reply"}}]}' });
    await assert.rejects(() => pending, /已停止等待/);
    assert.equal(released, 1);
    const next = stoppedClient.chat(settings, 'temporary-token', request);
    finish({ responseCode: 200, result: '{"choices":[{"message":{"content":"new reply"}}]}' });
    assert.equal(await next, 'new reply');
    assert.equal(released, 2);
  });
  await test('transport rejection after stop reports uncertainty without retry', async () => {
    let rejectRequest, calls = 0, released = 0;
    const transport = { ...http, createHttp() { return {
      request() { calls++; return new Promise((_resolve, reject) => { rejectRequest = reject; }); },
      destroy() { released++; rejectRequest(Error('private transport details')); }
    }; } };
    const Stoppable = load('services/HermesClient.ets', {
      '@kit.NetworkKit': { http: transport }, '../core/Domain': domain, '../core/Workspace': load('core/Workspace.ts', { './Domain': domain, './Reading': load('core/Reading.ts') })
    }).HermesClient;
    const stoppedClient = new Stoppable();
    const pending = stoppedClient.chat(settings, 'temporary-token', request);
    stoppedClient.stop();
    await assert.rejects(() => pending, /服务端可能仍在执行/);
    assert.equal(calls, 1); assert.equal(released, 1);
  });
  let calendarGrant = 0, calendarReads = 0, requestedPermissions;
  let calendarEvents = [];
  const native = load('services/NativeData.ets', {
    '@kit.AbilityKit': { abilityAccessCtrl: { createAtManager: () => ({
      async requestPermissionsFromUser(_context, permissions) {
        requestedPermissions = permissions; return { authResults: [calendarGrant] };
      }
    }) } },
    '@kit.CalendarKit': { calendarManager: {
      getCalendarManager: () => ({ async getAllCalendars() {
        calendarReads++; return [{ id: 7, async queryEventInstances(start, end, ids, fields) {
          const filter = { start, end };
          assert.equal(new Date(filter.start).getHours(), 0);
          const tomorrow = new Date(filter.start); tomorrow.setDate(tomorrow.getDate() + 1);
          assert.equal(filter.end, tomorrow.getTime());
          assert.deepEqual(Array.from(fields), ['id', 'title', 'startTime', 'endTime', 'instanceStartTime', 'instanceEndTime', 'isAllDay']);
          return calendarEvents;
        } }];
      } }),
      EventFilter: { filterByTime: (start, end) => ({ start, end }) }
    } },
    '@kit.BasicServicesKit': { batteryInfo: {} },
    '@kit.BackgroundTasksKit': { reminderAgentManager: {} },
    '@kit.NotificationKit': { notificationManager: {} }, '../core/Domain': domain, '../core/Workspace': load('core/Workspace.ts', { './Domain': domain, './Reading': load('core/Reading.ts') })
  });
  await test('phone calendar requests whole-calendar read permission and filters today', async () => {
    const now = Date.now();
    calendarEvents = [{ id: 1, title: 'Calendar fixture', startTime: now, endTime: now + 60000 }];
    assert.match(await native.readCalendar({}), /Calendar fixture/);
    assert.deepEqual(Array.from(requestedPermissions), ['ohos.permission.READ_WHOLE_CALENDAR']);
    const manifest = fs.readFileSync(path.join(__dirname, '../entry/src/main/module.json5'), 'utf8');
    assert.match(manifest, /"name": "ohos.permission.READ_WHOLE_CALENDAR"/);
  });
  await test('denied calendar permission never queries data and explains recovery', async () => {
    calendarGrant = -1; const before = calendarReads;
    await assert.rejects(() => native.readCalendar({}), /系统设置.*手动计划/);
    assert.equal(calendarReads, before);
  });
  await test('authorized empty calendar is distinct from denied access', async () => {
    calendarGrant = 0; calendarEvents = [];
    assert.equal(await native.readCalendar({}), '今日日历暂无日程');
  });
  await test('calendar instances retain stable identities and actual occurrence times', async () => {
    const now = Date.now();
    calendarEvents = [
      { id: 1, title: 'Repeat', startTime: 1, endTime: 2, instanceStartTime: now, instanceEndTime: now + 1000 },
      { id: 1, title: 'Repeat', startTime: 1, endTime: 2, instanceStartTime: now, instanceEndTime: now + 1000 },
      { id: 2, title: 'Repeat', startTime: now, endTime: now + 1000, isAllDay: true }
    ];
    const entries = await native.readCalendarEntries({});
    assert.equal(entries.length, 2); assert.equal(entries[0].key, `7/1/${now}`);
    assert.equal(entries[0].start, now); assert.equal(entries[1].allDay, true);
    calendarEvents = [{ title: 'Missing identity', startTime: now, endTime: now }];
    await assert.rejects(() => native.readCalendarEntries({}), /标识或时间/);
  });
  let multiEvents = {};
  const multiNative = load('services/NativeData.ets', {
    '@kit.AbilityKit': { abilityAccessCtrl: { createAtManager: () => ({
      async requestPermissionsFromUser() { return { authResults: [0] }; }
    }) } },
    '@kit.CalendarKit': { calendarManager: {
      getCalendarManager: () => ({ async getAllCalendars() {
        return [1, 2].map(id => ({ id, async queryEventInstances() { return multiEvents[id] || []; } }));
      } }),
      EventFilter: { filterByTime: (start, end) => ({ start, end }) }
    } },
    '@kit.BasicServicesKit': { batteryInfo: {} },
    '@kit.BackgroundTasksKit': { reminderAgentManager: {} },
    '@kit.NotificationKit': { notificationManager: {} }, '../core/Domain': domain, '../core/Workspace': load('core/Workspace.ts', { './Domain': domain, './Reading': load('core/Reading.ts') })
  });
  await test('calendar entries skip events outside today and merge calendars in start order', async () => {
    const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
    const t = dayStart.getTime(), hour = 3600000;
    multiEvents = {
      1: [
        { id: 1, title: 'Late', startTime: t + 20 * hour, endTime: t + 21 * hour },
        { id: 2, title: 'Yesterday', startTime: t - 2 * hour, endTime: t - hour },
        { id: 3, title: 'Tomorrow', startTime: t + 25 * hour, endTime: t + 26 * hour }
      ],
      2: [{ id: 4, title: 'Early', startTime: t + 8 * hour, endTime: t + 9 * hour }]
    };
    const entries = await multiNative.readCalendarEntries({});
    assert.deepEqual(Array.from(entries.map(e => e.title)), ['Early', 'Late']);
    assert.deepEqual(Array.from(entries.map(e => e.key)), [`2/4/${t + 8 * hour}`, `1/1/${t + 20 * hour}`]);
  });
  await test('calendar entries fall back to event times and default the all-day flag', async () => {
    const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
    const t = dayStart.getTime();
    multiEvents = { 1: [{ id: 5, title: 'Plain', startTime: t + 3600000, endTime: t + 7200000 }], 2: [] };
    const entries = await multiNative.readCalendarEntries({});
    assert.equal(entries[0].start, t + 3600000); assert.equal(entries[0].end, t + 7200000);
    assert.equal(entries[0].allDay, false);
  });
  const files = new Map();
  let renameFailure = false, partial = false, closed = 0, zeroWrite = false;
  const fileIo = {
    OpenMode: { CREATE: 1, WRITE_ONLY: 2, TRUNC: 4 },
    accessSync(file) { return files.has(file); },
    readTextSync(file) { return files.get(file).toString('utf8'); },
    openSync(file) { files.set(file, Buffer.alloc(0)); return { fd: file }; },
    writeSync(fd, buffer) {
      const bytes = Buffer.from(buffer);
      if (zeroWrite) { return 0; }
      const written = partial ? Math.min(7, bytes.length) : bytes.length;
      files.set(fd, Buffer.concat([files.get(fd), bytes.subarray(0, written)])); return written;
    },
    fsyncSync() {}, closeSync() { closed++; },
    renameSync(from, to) { if (renameFailure) throw Error('disk failure'); files.set(to, files.get(from)); files.delete(from); }
  };
  class Encoder { encodeInto(value) { return new TextEncoder().encode(value); } }
  const Repository = load('services/Repository.ets', {
    '@kit.CoreFileKit': { fileIo }, '@kit.ArkTS': { util: { TextEncoder: Encoder } }, '../core/Domain': domain, '../core/Workspace': load('core/Workspace.ts', { './Domain': domain, './Reading': load('core/Reading.ts') })
  }).Repository;
  const repo = new Repository();
  await test('first load initializes empty data and Unicode survives partial writes', async () => {
    const data = await repo.load({ filesDir: '/sandbox' });
    assert.equal(data.notes.length, 0);
    data.notes.push({ id: '1', text: '个人数据🪴'.repeat(300), createdAt: 1 });
    partial = true; await repo.save(data); partial = false;
    assert.equal((await repo.load({ filesDir: '/sandbox' })).notes[0].text, data.notes[0].text);
    assert.equal(closed, 1);
  });
  await test('failed atomic replacement preserves previous persisted data', async () => {
    renameFailure = true;
    await assert.rejects(() => repo.save(domain.initialData()), /disk failure/);
    renameFailure = false;
    assert.equal((await repo.load({ filesDir: '/sandbox' })).notes.length, 1);
  });
  await test('damaged storage fails load instead of silently overwriting records', async () => {
    files.set('/sandbox/hermes-eye-v1.json', Buffer.from('{invalid'));
    await assert.rejects(() => repo.load({ filesDir: '/sandbox' }));
    assert.equal(files.get('/sandbox/hermes-eye-v1.json').toString(), '{invalid');
  });
  let keyboardListener, detached = 0, selectedMode, keyboardHeight = 0;
  const keyboardWindow = {
    getUIContext() { return { setKeyboardAvoidMode(mode) { selectedMode = mode; } }; },
    getWindowAvoidArea() { return { bottomRect: { height: keyboardHeight } }; },
    on(event, callback) { assert.equal(event, 'keyboardHeightChange'); keyboardListener = callback; },
    off(event, callback) {
      assert.equal(event, 'keyboardHeightChange'); assert.equal(callback, keyboardListener);
      keyboardListener = undefined; detached++;
    }
  };
  let resolveWindow;
  const keyboardApi = {
    AvoidAreaType: { TYPE_KEYBOARD: 4 },
    async getLastWindow() { return keyboardWindow; }
  };
  const KeyboardAvoidance = load('services/KeyboardAvoidance.ets', {
    '@kit.ArkUI': { window: keyboardApi, KeyboardAvoidMode: { RESIZE_WITH_CARET: 3 } }
  }).KeyboardAvoidance;
  await test('keyboard resizes with caret and navigation follows actual visibility, not focus', async () => {
    const service = new KeyboardAvoidance(); const visible = [];
    await service.start({}, value => visible.push(value));
    assert.equal(selectedMode, 3); assert.deepEqual(visible, [false]);
    keyboardListener(360); keyboardListener(420); keyboardListener(0);
    assert.deepEqual(visible, [false, true, true, false]);
    service.stop(); assert.equal(detached, 1);
  });
  await test('already visible keyboard is detected when attaching', async () => {
    keyboardHeight = 320; const service = new KeyboardAvoidance(); const visible = [];
    await service.start({}, value => visible.push(value));
    assert.deepEqual(visible, [true]); service.stop(); keyboardHeight = 0;
  });
  await test('leaving before window lookup completes cannot attach a stale keyboard listener', async () => {
    keyboardApi.getLastWindow = () => new Promise(resolve => { resolveWindow = resolve; });
    const service = new KeyboardAvoidance(); const visible = [];
    const pending = service.start({}, value => visible.push(value));
    service.stop(); resolveWindow(keyboardWindow); await pending;
    assert.equal(keyboardListener, undefined); assert.deepEqual(visible, []);
    keyboardApi.getLastWindow = async () => keyboardWindow;
  });
  await test('restarting keyboard observation removes only its own listener and ignores queued old events', async () => {
    const service = new KeyboardAvoidance(); const oldValues = []; const newValues = [];
    await service.start({}, value => oldValues.push(value)); const oldListener = keyboardListener;
    await service.start({}, value => newValues.push(value)); oldListener(300); keyboardListener(300);
    assert.deepEqual(oldValues, [false]); assert.deepEqual(newValues, [false, true]);
    service.stop(); service.stop();
  });
  let checkStatus = 200, checkBody = '{"data":[{"id":"hermes-agent"}]}', checkUrl = '', checkMethod = '', checkAuth = '';
  const checkHttp = {
    RequestMethod: { POST: 'POST', GET: 'GET' }, HttpDataType: { STRING: 'STRING' },
    createHttp() { return {
      async request(url, options) {
        checkUrl = url; checkMethod = options.method; checkAuth = options.header.Authorization;
        return { responseCode: checkStatus, result: checkBody };
      }, destroy() {}
    }; }
  };
  const Checker = load('services/HermesClient.ets', { '@kit.NetworkKit': { http: checkHttp }, '../core/Domain': domain, '../core/Workspace': load('core/Workspace.ts', { './Domain': domain, './Reading': load('core/Reading.ts') }) }).HermesClient;
  const checker = new Checker();
  await test('connection check probes the models endpoint with GET and bearer', async () => {
    await checker.check(settings, 'probe-token');
    assert.equal(checkUrl, 'https://example.org/v1/models');
    assert.equal(checkMethod, 'GET'); assert.equal(checkAuth, 'Bearer probe-token');
  });
  await test('connection check distinguishes authentication, HTTP and protocol failures', async () => {
    checkStatus = 401; await assert.rejects(() => checker.check(settings, 'probe-token'), /认证失败/);
    checkStatus = 500; await assert.rejects(() => checker.check(settings, 'probe-token'), /HTTP 500/);
    checkStatus = 200; checkBody = '{"choices":[]}';
    await assert.rejects(() => checker.check(settings, 'probe-token'), /模型列表/);
    checkBody = '{"data":[{"id":"hermes-agent"}]}';
  });
  const workspace = load('core/Workspace.ts', { './Domain': domain, './Reading': load('core/Reading.ts') });
  const secrets = new Map();
  const asset = {
    Tag: { ALIAS: 1, SECRET: 2, ACCESSIBILITY: 3, RETURN_TYPE: 4 }, Accessibility: { DEVICE_UNLOCKED: 2 }, ReturnType: { ALL: 0 },
    async add(map) { secrets.set(Buffer.from(map.get(1)).toString(), map.get(2)); },
    async query(map) { const secret = secrets.get(Buffer.from(map.get(1)).toString()); return secret ? [new Map([[2, secret]])] : []; },
    async remove(map) { secrets.delete(Buffer.from(map.get(1)).toString()); }
  };
  class CredentialEncoder { encodeInto(value) { return new TextEncoder().encode(value); } }
  const credentialUtil = {
    TextEncoder: CredentialEncoder,
    TextDecoder: { create() { return { decodeToString: value => new TextDecoder().decode(value) }; } }
  };
  const Store = load('services/CredentialStore.ets', {
    '@kit.AssetStoreKit': { asset }, '@kit.ArkTS': { util: credentialUtil }, '../core/Workspace': workspace
  }).CredentialStore;
  const store = new Store();
  await test('blank token is rejected before touching secure storage', async () => {
    await assert.rejects(() => store.save('   '), /Token/); assert.equal(secrets.size, 0);
  });
  await test('missing reference reads as absent without a backend call', async () => {
    assert.equal(await store.read(''), '');
  });
  let reminderRequest, notificationRequests = 0, cancelledId = -1;
  const nativeReminders = load('services/NativeData.ets', {
    '@kit.AbilityKit': { abilityAccessCtrl: { createAtManager: () => ({
      async requestPermissionsFromUser() { return { authResults: [0] }; }
    }) } },
    '@kit.CalendarKit': { calendarManager: {
      getCalendarManager: () => ({ async getAllCalendars() { return []; } }),
      EventFilter: { filterByTime: (start, end) => ({ start, end }) }
    } },
    '@kit.BasicServicesKit': { batteryInfo: { batterySOC: 80 } },
    '@kit.BackgroundTasksKit': { reminderAgentManager: {
      ReminderType: { REMINDER_TYPE_ALARM: 0 },
      async publishReminder(request) { reminderRequest = request; return 42; },
      async cancelReminder(id) { cancelledId = id; }
    } },
    '@kit.NotificationKit': { notificationManager: { async requestEnableNotification() { notificationRequests++; } } },
    '../core/Domain': domain, '../core/Workspace': load('core/Workspace.ts', { './Domain': domain, './Reading': load('core/Reading.ts') })
  });
  await test('reminder registration requests notification first and maps weekday sets', async () => {
    const id = await nativeReminders.publishReminder({}, '喝水', '08:30', true);
    assert.equal(id, 42); assert.equal(notificationRequests, 1);
    assert.equal(reminderRequest.hour, 8); assert.equal(reminderRequest.minute, 30);
    assert.deepEqual(Array.from(reminderRequest.daysOfWeek), [1, 2, 3, 4, 5]);
    await nativeReminders.publishReminder({}, '周末也提醒', '09:00', false);
    assert.deepEqual(Array.from(reminderRequest.daysOfWeek), [1, 2, 3, 4, 5, 6, 7]);
  });
  await test('invalid reminder input fails before any system registration', async () => {
    const before = notificationRequests;
    await assert.rejects(() => nativeReminders.publishReminder({}, '   ', '08:30', false));
    await assert.rejects(() => nativeReminders.publishReminder({}, 'x', '25:00', false));
    assert.equal(notificationRequests, before);
  });
  await test('cancelling a reminder passes through the system identifier', async () => {
    await nativeReminders.cancelReminder(42); assert.equal(cancelledId, 42);
  });
  // Issue 8: assert failure semantics, not merely the presence of try/catch.
  const sdkFailure = code => Object.assign(new Error('private-token-and-path'), { code });
  await test('asset failures keep safe operation/code diagnostics and missing removal is idempotent', async () => {
    const failingAsset = { ...asset,
      async add() { throw sdkFailure(24000005); },
      async query() { throw sdkFailure(24000002); },
      async remove() { throw sdkFailure(24000002); }
    };
    const FailedStore = load('services/CredentialStore.ets', {
      '@kit.AssetStoreKit': { asset: failingAsset }, '@kit.ArkTS': { util: credentialUtil }, '../core/Workspace': workspace
    }).CredentialStore;
    const failedStore = new FailedStore();
    await assert.rejects(() => failedStore.save('must-stay-secret'), error =>
      /24000005/.test(error.message) && /解锁/.test(error.message) && !/private|must-stay-secret/.test(error.message));
    await assert.rejects(() => failedStore.read('missing'), /24000002/);
    await failedStore.remove('missing');
    failingAsset.remove = async () => { throw sdkFailure(24000008); };
    await assert.rejects(() => failedStore.remove('reference'), /24000008/);
  });
  await test('filesystem failures do not replace old data and close failures do not mask write failures', async () => {
    const localFiles = new Map(); let failing = ''; let closed = 0; let renamed = 0;
    const io = {
      OpenMode: { CREATE: 1, WRITE_ONLY: 2, TRUNC: 4 },
      accessSync(file) { if (failing === 'access') throw sdkFailure(13900012); return localFiles.has(file); },
      readTextSync(file) { if (failing === 'read') throw sdkFailure(13900005); return localFiles.get(file); },
      openSync(file) { if (failing === 'open') throw sdkFailure(13900025); localFiles.set(file, ''); return { fd: file }; },
      writeSync(fd, buffer) { if (failing === 'write-close') throw sdkFailure(13900025); const b = Buffer.from(buffer); localFiles.set(fd, localFiles.get(fd) + b.toString()); return b.length; },
      fsyncSync() { if (failing === 'sync') throw sdkFailure(13900005); },
      closeSync() { closed++; if (['close', 'write-close'].includes(failing)) throw sdkFailure(13900008); },
      renameSync(from, to) { if (failing === 'rename') throw sdkFailure(13900012); renamed++; localFiles.set(to, localFiles.get(from)); }
    };
    const Repo = load('services/WorkspaceRepository.ets', {
      '@kit.CoreFileKit': { fileIo: io }, '@kit.ArkTS': { util: credentialUtil }, '../core/Workspace': workspace
    }).WorkspaceRepository;
    const repo = new Repo(); const data = await repo.load({ filesDir: '/test' });
    const original = localFiles.get('/test/hermes-eye-workspace-v2.json'); data.appearance = 2;
    for (const stage of ['open', 'write-close', 'sync', 'close', 'rename']) {
      failing = stage; const beforeClosed = closed; const beforeRenamed = renamed;
      await assert.rejects(() => repo.save(data), error => {
        assert.ok(!error.message.includes('private-token-and-path'));
        if (stage === 'write-close') { assert.match(error.message, /13900025/); assert.match(error.message, /13900008/); }
        return true;
      });
      assert.equal(localFiles.get('/test/hermes-eye-workspace-v2.json'), original);
      assert.equal(renamed, beforeRenamed); assert.equal(closed, beforeClosed + (stage === 'open' ? 0 : 1));
    }
    for (const stage of ['access', 'read']) {
      failing = stage;
      await assert.rejects(() => repo.load({ filesDir: '/test' }), /139000/);
      await assert.rejects(() => repo.save(data), /未就绪/);
      assert.equal(localFiles.get('/test/hermes-eye-workspace-v2.json'), original);
    }
    failing = ''; await repo.load({ filesDir: '/test' }); await repo.save(data);
    assert.equal(JSON.parse(localFiles.get('/test/hermes-eye-workspace-v2.json')).appearance, 2);
  });
  await test('calendar SDK failures identify their stage and never return partial or fabricated results', async () => {
    let stage = ''; let queryCalls = 0;
    const calendar = { id: 1, async queryEventInstances() { queryCalls++; throw sdkFailure(201); } };
    const service = load('services/NativeData.ets', {
      '@kit.AbilityKit': { abilityAccessCtrl: { createAtManager() {
        return { async requestPermissionsFromUser() {
          if (stage === 'permission') throw sdkFailure(12100009);
          return { authResults: [0] };
        } };
      } } },
      '@kit.CalendarKit': { calendarManager: { getCalendarManager() { return {
        async getAllCalendars() { if (stage === 'list') throw sdkFailure(801); return [calendar]; }
      }; } } },
      '@kit.BasicServicesKit': { batteryInfo: {} }, '@kit.BackgroundTasksKit': { reminderAgentManager: {} },
      '@kit.NotificationKit': { notificationManager: {} }, '../core/Domain': domain, '../core/Workspace': workspace
    });
    stage = 'permission'; await assert.rejects(() => service.readCalendarEntries({}), /calendar.permission.*12100009/);
    stage = 'list'; await assert.rejects(() => service.readCalendarEntries({}), /不支持.*calendar.list.*801/);
    assert.equal(queryCalls, 0);
    stage = 'query'; await assert.rejects(() => service.readCalendarEntries({}), /权限.*calendar.instances.*201/);
    assert.equal(queryCalls, 1);
  });
  await test('notification refusal prevents reminder publication and SDK failures are never automatically retried', async () => {
    let notificationCode = 1600004; let publishCalls = 0; let cancelCode = 1700003;
    const service = load('services/NativeData.ets', {
      '@kit.AbilityKit': { abilityAccessCtrl: {} }, '@kit.CalendarKit': { calendarManager: {} },
      '@kit.BasicServicesKit': { batteryInfo: {} },
      '@kit.BackgroundTasksKit': { reminderAgentManager: { ReminderType: { REMINDER_TYPE_ALARM: 0 },
        async publishReminder() { publishCalls++; throw sdkFailure(1700002); },
        async cancelReminder() { throw sdkFailure(cancelCode); }
      } },
      '@kit.NotificationKit': { notificationManager: {
        async requestEnableNotification() { if (notificationCode) throw sdkFailure(notificationCode); }
      } }, '../core/Domain': domain, '../core/Workspace': workspace
    });
    await assert.rejects(() => service.publishReminder({}, '提醒', '08:30', false), /通知权限.*1600004/);
    assert.equal(publishCalls, 0); notificationCode = 0;
    await assert.rejects(() => service.publishReminder({}, '提醒', '08:30', false), /上限.*1700002/);
    assert.equal(publishCalls, 1);
    await service.cancelReminder(7); // Already absent is the desired state.
    cancelCode = 1700004; await assert.rejects(() => service.cancelReminder(7), /1700004/);
  });
  await test('keyboard initialization failure cleans registered listeners and preserves safe diagnostics', async () => {
    const originalArea = keyboardWindow.getWindowAvoidArea;
    keyboardWindow.getWindowAvoidArea = () => { throw sdkFailure(1300002); };
    const service = new KeyboardAvoidance();
    await assert.rejects(() => service.start({}, () => {}), /window.keyboardArea.*1300002/);
    assert.equal(keyboardListener, undefined);
    keyboardWindow.getWindowAvoidArea = originalArea;
    await service.start({}, () => {}); service.stop();
    keyboardApi.getLastWindow = async () => { throw sdkFailure(1300006); };
    await assert.rejects(() => service.start({}, () => {}), /window.lookup.*1300006/);
    keyboardApi.getLastWindow = async () => keyboardWindow;
  });
  await test('keyboard cleanup failure keeps retry handle but ignores callbacks; destroyed windows are tolerated', async () => {
    const originalOff = keyboardWindow.off; let cleanupCode = 401;
    keyboardWindow.off = () => { throw sdkFailure(cleanupCode); };
    const service = new KeyboardAvoidance(); const values = [];
    await service.start({}, visible => values.push(visible)); const lateListener = keyboardListener;
    assert.throws(() => service.stop(), /window.keyboardOff.*401/);
    lateListener(300); assert.deepEqual(values, [false]);
    keyboardWindow.off = originalOff; service.stop(); assert.equal(keyboardListener, undefined);
    await service.start({}, () => {}); cleanupCode = 1300002;
    keyboardWindow.off = () => { throw sdkFailure(cleanupCode); };
    service.stop(); keyboardWindow.off = originalOff; keyboardListener = undefined;
  });
  await test('Toast SDK failure cannot escape into business save and logs no message or token', async () => {
    const presentation = load('services/SystemPresentation.ets', { '@kit.AbilityKit': { ConfigurationConstant: {} } });
    const before = platformLogs.length;
    assert.equal(presentation.showToast({ getPromptAction() { return {
      showToast() { throw sdkFailure(100001); }
    }; } }, 'private business text', true), false);
    assert.equal(platformLogs.length, before + 1);
    const log = JSON.stringify(platformLogs.at(-1));
    assert.match(log, /100001/); assert.ok(!/private|business text/.test(log));
  });
  await test('appearance invalid input never calls SDK and context failures keep numeric diagnosis', async () => {
    const presentation = load('services/SystemPresentation.ets', {
      '@kit.AbilityKit': { ConfigurationConstant: { ColorMode: {
        COLOR_MODE_NOT_SET: -1, COLOR_MODE_LIGHT: 1, COLOR_MODE_DARK: 0
      } } }
    });
    let calls = 0;
    const context = { getApplicationContext() { return { setColorMode() { calls++; throw sdkFailure(16000011); } }; } };
    assert.throws(() => presentation.applySystemAppearance(context, 5), /无效/); assert.equal(calls, 0);
    assert.throws(() => presentation.applySystemAppearance(context, 1), /appearance.setColorMode.*16000011/);
    assert.equal(calls, 1);
  });
  await test('saving without a loaded path and a zero-length write both fail closed', async () => {
    await assert.rejects(() => new Repository().save(domain.initialData()), /尚未就绪/);
    const path = '/sandbox/hermes-eye-v1.json';
    const before = files.get(path).toString();
    zeroWrite = true;
    await assert.rejects(() => repo.save(domain.initialData()), /本地文件写入未完成/);
    zeroWrite = false;
    assert.equal(files.get(path).toString(), before);
  });
  await test('stored credentials round-trip and an absent reference never reaches the backend', async () => {
    const reference = await store.save('valid-token');
    assert.match(reference, /^hermes-eye-/);
    assert.equal(await store.read(reference), 'valid-token');
    assert.equal(await store.read(''), '');
    await store.remove('');
    await store.remove(reference);
    await assert.rejects(() => store.read(reference), /解锁设备或重新填写 Token/);
    assert.equal(secrets.size, 0);
  });
  await test('credential advice distinguishes missing, locked and unknown asset codes', async () => {
    const failing = code => ({ ...asset, async query() { throw sdkFailure(code); } });
    const cases = [[24000002, /重新填写 Token/], [24000004, /解锁设备后重试/], [24000005, /解锁设备后重试/], [24000001, /解锁设备或重新填写 Token/]];
    for (const [code, pattern] of cases) {
      const Failed = load('services/CredentialStore.ets', {
        '@kit.AssetStoreKit': { asset: failing(code) }, '@kit.ArkTS': { util: credentialUtil }, '../core/Workspace': workspace
      }).CredentialStore;
      await assert.rejects(() => new Failed().read('reference'), error => error.message.includes(String(code)) && pattern.test(error.message));
    }
    const addFailed = { ...asset, async add() { throw sdkFailure(24000001); } };
    const AddFailed = load('services/CredentialStore.ets', {
      '@kit.AssetStoreKit': { asset: addFailed }, '@kit.ArkTS': { util: credentialUtil }, '../core/Workspace': workspace
    }).CredentialStore;
    await assert.rejects(() => new AddFailed().save('kept-secret'), error => /安全存储失败/.test(error.message) && !/解锁/.test(error.message));
  });
  await test('overlapping requests destroy only the transport that is still active', async () => {
    const resolvers = []; const destroyed = []; let created = 0;
    const transport = { RequestMethod: { POST: 'POST', GET: 'GET' }, HttpDataType: { STRING: 'STRING' },
      createHttp() { const id = created++; return {
        request() { return new Promise(resolve => resolvers.push(resolve)); },
        destroy() { destroyed.push(id); }
      }; } };
    const Overlapping = load('services/HermesClient.ets', {
      '@kit.NetworkKit': { http: transport }, '../core/Domain': domain, '../core/Workspace': workspace
    }).HermesClient;
    const overlapping = new Overlapping();
    const first = overlapping.chat(settings, 'temporary-token', request);
    const second = overlapping.chat(settings, 'temporary-token', request);
    resolvers[1]({ responseCode: 200, result: '{"choices":[{"message":{"content":"second"}}]}' });
    resolvers[0]({ responseCode: 200, result: '{"choices":[{"message":{"content":"first"}}]}' });
    assert.equal(await first, 'first'); assert.equal(await second, 'second');
    assert.deepEqual(Array.from(destroyed), [1]);
  });
  await test('a keyboard failure after teardown is reported instead of tearing down a newer attachment', async () => {
    let rejectWindow;
    keyboardApi.getLastWindow = () => new Promise((_resolve, reject) => { rejectWindow = reject; });
    const service = new KeyboardAvoidance();
    const before = platformLogs.length;
    const pending = service.start({}, () => {});
    service.stop();
    rejectWindow(sdkFailure(1300006));
    await pending;
    assert.equal(platformLogs.length, before + 1);
    assert.match(JSON.stringify(platformLogs.at(-1)), /window\.lookup.*1300006/);
    keyboardApi.getLastWindow = async () => keyboardWindow;
  });
  await test('keyboard initialization failure still reports when listener cleanup itself fails', async () => {
    const originalArea = keyboardWindow.getWindowAvoidArea;
    const originalOff = keyboardWindow.off;
    keyboardWindow.getWindowAvoidArea = () => { throw sdkFailure(401); };
    keyboardWindow.off = () => { throw sdkFailure(500); };
    const service = new KeyboardAvoidance();
    const before = platformLogs.length;
    await assert.rejects(() => service.start({}, () => {}), /键盘适配初始化失败.*401/);
    const cleanup = platformLogs.slice(before).find(entry => String(entry[3]) === 'window.keyboardCleanup');
    assert.equal(cleanup !== undefined, true);
    assert.match(JSON.stringify(cleanup), /500/);
    keyboardWindow.getWindowAvoidArea = originalArea; keyboardWindow.off = originalOff;
  });
  await test('presentation failures without known SDK codes still report and never block the caller', async () => {
    const presentation = load('services/SystemPresentation.ets', {
      '@kit.AbilityKit': { ConfigurationConstant: { ColorMode: { COLOR_MODE_NOT_SET: -1, COLOR_MODE_LIGHT: 1, COLOR_MODE_DARK: 0 } } }
    });
    const before = platformLogs.length;
    const toast = { getPromptAction() { return { showToast() { throw sdkFailure(401); } }; } };
    assert.equal(presentation.showToast(toast, 'private text', false), false);
    assert.equal(platformLogs.length, before + 1);
    assert.match(JSON.stringify(platformLogs.at(-1)), /toast\.show.*401/);
    const context = { getApplicationContext() { return { setColorMode() { throw sdkFailure(16000010); } }; } };
    assert.throws(() => presentation.applySystemAppearance(context, 2), /显示模式切换失败.*16000010/);
  });
  await test('connection save rolls back the new credential and cleans the replaced one despite cleanup failures', async () => {
    const { ConnectionService } = load('services/ConnectionService.ets', { '../core/Workspace': workspace });
    const input = { name: 'Local', host: '127.0.0.1', protocol: 'http', port: 8787, basePath: '', model: 'hermes',
      allowPrivateHttp: true, autoConnect: false, credentialRef: '' };
    const removed = [];
    let removeThrows = true;
    const credentials = { async save() { return 'ref-new'; },
      async remove(reference) { removed.push(reference); if (removeThrows) { throw sdkFailure(24000008); } } };
    let failSave = true;
    const repository = { async save() { if (failSave) { throw new Error('disk failure'); } } };
    const service = new ConnectionService(repository, credentials);
    const before = platformLogs.length;
    await assert.rejects(() => service.save(workspace.newWorkspace(), input, 'token'), /旧配置仍有效/);
    assert.deepEqual(removed, ['ref-new']);
    assert.match(JSON.stringify(platformLogs.slice(before)), /asset\.rollbackCleanup.*24000008/);
    removeThrows = false; removed.length = 0;
    await assert.rejects(() => service.save(workspace.newWorkspace(), input, 'token'), /旧配置仍有效/);
    assert.deepEqual(removed, ['ref-new']);
    failSave = false; removeThrows = true; removed.length = 0;
    const current = workspace.newWorkspace();
    current.connection = { ...input, credentialRef: 'ref-old' };
    const next = await service.save(current, input, 'token');
    assert.equal(next.connection.credentialRef, 'ref-new');
    assert.deepEqual(removed, ['ref-old']);
    assert.match(JSON.stringify(platformLogs.slice(before)), /asset\.oldCredentialCleanup.*24000008/);
    removeThrows = false; removed.length = 0;
    const again = await service.save(current, input, 'token');
    assert.equal(again.connection.credentialRef, 'ref-new');
    assert.deepEqual(removed, ['ref-old']);
  });
  await test('calendar entries default the title and all-day flag and format text for both modes', async () => {
    const day = new Date(); day.setHours(9, 0, 0, 0);
    const service = load('services/NativeData.ets', {
      '@kit.AbilityKit': { abilityAccessCtrl: { createAtManager() {
        return { async requestPermissionsFromUser() { return { authResults: [0] }; } };
      } } },
      '@kit.CalendarKit': { calendarManager: { getCalendarManager() { return {
        async getAllCalendars() { return [{ id: 3, async queryEventInstances() {
          return [{ id: 11, startTime: day.getTime(), endTime: day.getTime() + 60000 }];
        } }]; }
      }; } } },
      '@kit.BasicServicesKit': { batteryInfo: { batterySOC: 55 } }, '@kit.BackgroundTasksKit': { reminderAgentManager: {} },
      '@kit.NotificationKit': { notificationManager: {} }, '../core/Domain': domain, '../core/Workspace': workspace
    });
    assert.match(service.deviceSnapshot(), /电量 55%/);
    await assert.rejects(() => service.readCalendarEntries({}, 'invalid'), /有效日期/);
    const entries = await service.readCalendarEntries({});
    assert.equal(entries[0].title, '未命名日程'); assert.equal(entries[0].allDay, false);
    assert.match(service.calendarText(entries), /未命名日程$/);
    assert.equal(service.calendarText([{ key: 'k', title: '全天事项', start: 1, end: 2, allDay: true }]), '全天 全天事项');
    assert.equal(service.calendarText([]), '今日日历暂无日程');
  });
  await test('calendar SDK failures keep the failing stage and every recovery advice', async () => {
    let permissionCode = 12100001; let listCode = 0;
    const service = load('services/NativeData.ets', {
      '@kit.AbilityKit': { abilityAccessCtrl: { createAtManager() {
        return { async requestPermissionsFromUser() {
          if (permissionCode) { throw sdkFailure(permissionCode); }
          return { authResults: [0] };
        } };
      } } },
      '@kit.CalendarKit': { calendarManager: { getCalendarManager() { return {
        async getAllCalendars() { if (listCode) { throw sdkFailure(listCode); } return []; }
      }; } } },
      '@kit.BasicServicesKit': { batteryInfo: {} }, '@kit.BackgroundTasksKit': { reminderAgentManager: {} },
      '@kit.NotificationKit': { notificationManager: {} }, '../core/Domain': domain, '../core/Workspace': workspace
    });
    await assert.rejects(() => service.readCalendarEntries({}), /calendar\.permission.*12100001/);
    permissionCode = 12100009;
    await assert.rejects(() => service.readCalendarEntries({}), /权限窗口暂不可用.*12100009/);
    permissionCode = 0; listCode = 13900005;
    await assert.rejects(() => service.readCalendarEntries({}), /读取日历失败.*13900005/);
    listCode = 801;
    await assert.rejects(() => service.readCalendarEntries({}), /不支持.*801/);
  });
  await test('reminder stages keep distinct advice for notification and publication failures', async () => {
    let notificationCode = 1600013; let publishCode = 0;
    const service = load('services/NativeData.ets', {
      '@kit.AbilityKit': { abilityAccessCtrl: {} }, '@kit.CalendarKit': { calendarManager: {} },
      '@kit.BasicServicesKit': { batteryInfo: {} },
      '@kit.BackgroundTasksKit': { reminderAgentManager: { ReminderType: { REMINDER_TYPE_ALARM: 0 },
        async publishReminder() { if (publishCode) { throw sdkFailure(publishCode); } return 7; },
        async cancelReminder() {} } },
      '@kit.NotificationKit': { notificationManager: {
        async requestEnableNotification() { if (notificationCode) { throw sdkFailure(notificationCode); } }
      } }, '../core/Domain': domain, '../core/Workspace': workspace
    });
    await assert.rejects(() => service.publishReminder({}, '提醒', '08:30', false), /通知授权窗口.*1600013/);
    notificationCode = 1600001;
    await assert.rejects(() => service.publishReminder({}, '提醒', '08:30', false), /通知授权失败.*1600001/);
    notificationCode = 0; publishCode = 1700001;
    await assert.rejects(() => service.publishReminder({}, '提醒', '08:30', false), /权限未开启.*1700001/);
    publishCode = 201;
    await assert.rejects(() => service.publishReminder({}, '提醒', '08:30', false), /权限未开启.*201/);
    publishCode = 1700005;
    await assert.rejects(() => service.publishReminder({}, '提醒', '08:30', false), /注册失败.*1700005/);
    publishCode = 0;
    assert.equal(await service.publishReminder({}, '提醒', '08:30', true), 7);
  });
  await test('workspace load creates a fresh replica or migrates the legacy v1 file', async () => {
    const local = new Map(); let accessCode = 13900002;
    const io = {
      OpenMode: { CREATE: 1, WRITE_ONLY: 2, TRUNC: 4 },
      accessSync(file) {
        if (accessCode && file.endsWith('hermes-eye-workspace-v2.json')) { throw sdkFailure(accessCode); }
        return local.has(file);
      },
      readTextSync(file) { return local.get(file); },
      openSync(file) { local.set(file, ''); return { fd: file }; },
      writeSync(fd, buffer) { const bytes = Buffer.from(buffer); local.set(fd, local.get(fd) + bytes.toString()); return bytes.length; },
      fsyncSync() {}, closeSync() {},
      renameSync(from, to) { local.set(to, local.get(from)); local.delete(from); }
    };
    const Repo = load('services/WorkspaceRepository.ets', {
      '@kit.CoreFileKit': { fileIo: io }, '@kit.ArkTS': { util: credentialUtil }, '../core/Workspace': workspace
    }).WorkspaceRepository;
    const fresh = await new Repo().load({ filesDir: '/fresh' });
    assert.equal(fresh.version, 2); assert.equal(local.has('/fresh/hermes-eye-workspace-v2.json'), true);
    accessCode = 0;
    local.set('/legacy/hermes-eye-v1.json', JSON.stringify(domain.initialData()));
    const migrated = await new Repo().load({ filesDir: '/legacy' });
    assert.equal(migrated.version, 2); assert.equal(local.has('/legacy/hermes-eye-workspace-v2.json'), true);
  });
  console.log(`\n${passed} service tests passed with injected platform adapters; not a device/network integration test.`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
