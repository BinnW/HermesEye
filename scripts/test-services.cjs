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
const domain = load('core/Domain.ts');
let passed = 0;
async function test(name, action) { await action(); passed++; console.log('PASS ' + name); }
async function main() {
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
  const Client = load('services/HermesClient.ets', { '@kit.NetworkKit': { http }, '../core/Domain': domain, '../core/Workspace': load('core/Workspace.ts', { './Domain': domain }) }).HermesClient;
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
      '@kit.NetworkKit': { http: transport }, '../core/Domain': domain, '../core/Workspace': load('core/Workspace.ts', { './Domain': domain })
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
      '@kit.NetworkKit': { http: transport }, '../core/Domain': domain, '../core/Workspace': load('core/Workspace.ts', { './Domain': domain })
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
    '@kit.NotificationKit': { notificationManager: {} }, '../core/Domain': domain, '../core/Workspace': load('core/Workspace.ts', { './Domain': domain })
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
    '@kit.NotificationKit': { notificationManager: {} }, '../core/Domain': domain, '../core/Workspace': load('core/Workspace.ts', { './Domain': domain })
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
  let renameFailure = false, partial = false, closed = 0;
  const fileIo = {
    OpenMode: { CREATE: 1, WRITE_ONLY: 2, TRUNC: 4 },
    accessSync(file) { return files.has(file); },
    readTextSync(file) { return files.get(file).toString('utf8'); },
    openSync(file) { files.set(file, Buffer.alloc(0)); return { fd: file }; },
    writeSync(fd, buffer) {
      const bytes = Buffer.from(buffer);
      const written = partial ? Math.min(7, bytes.length) : bytes.length;
      files.set(fd, Buffer.concat([files.get(fd), bytes.subarray(0, written)])); return written;
    },
    fsyncSync() {}, closeSync() { closed++; },
    renameSync(from, to) { if (renameFailure) throw Error('disk failure'); files.set(to, files.get(from)); files.delete(from); }
  };
  class Encoder { encodeInto(value) { return new TextEncoder().encode(value); } }
  const Repository = load('services/Repository.ets', {
    '@kit.CoreFileKit': { fileIo }, '@kit.ArkTS': { util: { TextEncoder: Encoder } }, '../core/Domain': domain, '../core/Workspace': load('core/Workspace.ts', { './Domain': domain })
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
  const Checker = load('services/HermesClient.ets', { '@kit.NetworkKit': { http: checkHttp }, '../core/Domain': domain, '../core/Workspace': load('core/Workspace.ts', { './Domain': domain }) }).HermesClient;
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
  const workspace = load('core/Workspace.ts', { './Domain': domain });
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
    '../core/Domain': domain, '../core/Workspace': load('core/Workspace.ts', { './Domain': domain })
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
  console.log(`\n${passed} service tests passed with injected platform adapters; not a device/network integration test.`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
