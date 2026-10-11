const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { loadTypescript } = require('./lib/deveco-env.cjs');
const ts = loadTypescript();
function load(file, imports = {}) {
  const source = fs.readFileSync('entry/src/main/ets/' + file, 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2021, module: ts.ModuleKind.CommonJS } });
  const sandbox = { exports: {}, require(name) { if (!(name in imports)) throw Error(name); return imports[name]; } };
  vm.runInNewContext(compiled.outputText, sandbox, { filename: 'entry/src/main/ets/' + file });
  return sandbox.exports;
}
const rules = load('core/BusinessSync.ts');
const { BusinessCoordinator } = load('services/BusinessCoordinator.ets', { '../core/BusinessSync': rules });
const identity = { protocolVersion: 1, serverId: 'server', workspaceId: 'personal' };
const mutation = { deviceId: 'device', mutationId: 'm1', kind: 'plan', id: 'p1', baseRevision: 0, deleted: false, payload: { title: 'Read' } };
const entity = { kind: 'plan', id: 'p1', revision: 1, deleted: false, payload: { title: 'Read' }, origin: 'device' };
let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log('PASS ' + name); }
function harness() {
  let saved, fail = false, submissions = 0;
  const remote = {
    async identity() { return identity; },
    async mutate() { return { status: 'accepted', entity, cursor: 5 }; },
    async pull() { return { entities: [entity], cursor: 5, hasMore: false }; },
    async snapshot() { return { entities: [], cursor: 0 }; },
    async submit(intent) { submissions++; return { id: intent.operationId, needId: intent.needId, kind: intent.kind, state: 'completed', remoteId: null, result: { message: 'done' } }; },
    async query(id) { return { id, needId: 'n1', kind: 'chat', state: 'unknown', remoteId: null, result: {} }; }
  };
  const persistence = { async save(state) { if (fail) throw Error('disk failed'); saved = JSON.parse(JSON.stringify(state)); } };
  const coordinator = new BusinessCoordinator(rules.newBusinessState(identity, 'device'), persistence, remote);
  return { coordinator, remote, persistence, fail() { fail = true; }, saved() { return saved; }, submissions() { return submissions; } };
}
async function main() {
  await test('offline edit is durable and no network is needed', async () => {
    const h = harness(); h.remote.identity = async () => { throw Error('offline'); };
    await h.coordinator.edit(mutation);
    assert.equal(h.saved().outbox.length, 1);
    await assert.rejects(() => h.coordinator.synchronize(), /offline/);
    assert.equal(h.coordinator.current().outbox.length, 1);
  });
  await test('receipt must not skip other clients changes by advancing pull cursor', async () => {
    const h = harness(); await h.coordinator.edit(mutation);
    h.remote.pull = async cursor => { assert.equal(cursor, 0); return { entities: [entity], cursor: 5 }; };
    await h.coordinator.synchronize(); assert.equal(h.saved().cursor, 5); assert.equal(h.saved().outbox.length, 0);
  });
  await test('identity change prevents upload to another deployment or account', async () => {
    const h = harness(); await h.coordinator.edit(mutation);
    h.remote.identity = async () => ({ ...identity, workspaceId: 'other' });
    h.remote.mutate = async () => { assert.fail('must not upload'); };
    await assert.rejects(() => h.coordinator.synchronize(), /身份/);
  });
  await test('conflict preserves both versions instead of overwriting local intent', async () => {
    const h = harness(); await h.coordinator.edit(mutation);
    h.remote.mutate = async () => ({ status: 'conflict', remote: { ...entity, revision: 2, payload: { title: 'Other client' } } });
    await h.coordinator.synchronize();
    assert.equal(h.saved().conflicts[0].local.payload.title, 'Read');
    assert.equal(h.saved().conflicts[0].remote.payload.title, 'Other client');
  });
  await test('snapshot rebuild preserves pending edits and deletion tombstones', async () => {
    const state = rules.newBusinessState(identity, 'device'); rules.enqueueBusinessMutation(state, mutation);
    rules.applyBusinessPage(state, { entities: [{ ...entity, deleted: true }], cursor: 1 }, true);
    assert.equal(state.outbox.length, 1); assert.equal(state.entities[0].deleted, true);
  });
  await test('save failure never publishes a cursor or clears pending mutation', async () => {
    const h = harness(); await h.coordinator.edit(mutation); h.fail();
    await assert.rejects(() => h.coordinator.synchronize(), /disk failed/);
    assert.equal(h.coordinator.current().outbox.length, 1); assert.equal(h.coordinator.current().cursor, 0);
  });
  const intent = { operationId: 'o1', needId: 'n1', kind: 'chat', input: 'hello' };
  await test('intent write failure prevents remote execution', async () => {
    const h = harness(); h.fail(); await assert.rejects(() => h.coordinator.send(intent), /disk failed/);
    assert.equal(h.submissions(), 0);
  });
  await test('lost reply retains intent; recovery queries without resubmitting', async () => {
    const h = harness(); h.remote.submit = async () => { throw Error('timeout'); };
    await assert.rejects(() => h.coordinator.send(intent), /timeout/);
    assert.equal(h.saved().operations.length, 1);
    await assert.rejects(() => h.coordinator.send(intent), /操作已存在/);
    await h.coordinator.recover('o1'); assert.equal(h.saved().operations[0].operation.state, 'unknown');
  });
  await test('in-flight writes serialize and reject overlapping operations', async () => {
    const h = harness(); let release;
    h.persistence.save = () => new Promise(resolve => { release = resolve; });
    const pending = h.coordinator.edit(mutation);
    await assert.rejects(() => h.coordinator.edit({ ...mutation, mutationId: 'm2' }), /处理中/);
    release(); await pending;
  });
  await test('invalid acknowledgement cannot clear the outbox', async () => {
    const h = harness(); await h.coordinator.edit(mutation);
    h.remote.mutate = async () => ({ status: 'accepted', entity: { ...entity, id: 'wrong' } });
    await assert.rejects(() => h.coordinator.synchronize(), /回执/);
    assert.equal(h.coordinator.current().outbox.length, 1);
  });
  await test('business HTTP adapter uses its own root and credential and releases transport', async () => {
    let url, options, destroyed = 0;
    const http = { RequestMethod: { POST: 'POST', GET: 'GET' }, HttpDataType: { STRING: 'STRING' }, createHttp() { return {
      async request(u, o) { url = u; options = o; return { responseCode: 200, result: JSON.stringify(identity) }; }, destroy() { destroyed++; }
    }; } };
    const domain = load('core/Domain.ts');
    const { BusinessClient } = load('services/BusinessClient.ets', { '@kit.NetworkKit': { http }, '../core/Domain': domain });
    const client = new BusinessClient('https://example.org/proxy', 'business-token');
    await client.identity(); assert.equal(url, 'https://example.org/proxy/eye/v1/capabilities');
    assert.equal(options.header.Authorization, 'Bearer business-token'); assert.equal(options.maxRedirects, 0); assert.equal(destroyed, 1);
    assert.throws(() => new BusinessClient('https://example.org/v1', 'token'), /根地址/);
  });
  await test('conflict resolution keeps intent but uses a new ID and confirmed base', async () => {
    const h = harness(); await h.coordinator.edit(mutation);
    h.remote.mutate = async () => ({ status: 'conflict', remote: { ...entity, revision: 3 } });
    await h.coordinator.synchronize(); await h.coordinator.resolve('m1', true, 'resolution1');
    assert.equal(h.saved().outbox[0].mutationId, 'resolution1');
    assert.equal(h.saved().outbox[0].baseRevision, 3); assert.equal(h.saved().conflicts.length, 0);
  });
  await test('native business repository rejects stale writers and preserves confirmed disk data', async () => {
    const files = new Map(); let currentPath, bytes;
    const fileIo = {
      OpenMode: { CREATE: 1, WRITE_ONLY: 2, TRUNC: 4 }, accessSync: p => files.has(p), readTextSync: p => files.get(p),
      openSync(p) { currentPath = p; bytes = []; return { fd: 1 }; },
      writeSync(_fd, buffer) { bytes.push(...new Uint8Array(buffer)); return buffer.byteLength; },
      fsyncSync() {}, closeSync() { files.set(currentPath, new TextDecoder().decode(new Uint8Array(bytes))); },
      renameSync(from, to) { files.set(to, files.get(from)); files.delete(from); }
    };
    const platform = { platformCode: () => 0, platformFailure: (_stage, _error, advice) => Error(advice) };
    class Encoder { encodeInto(value) { return new TextEncoder().encode(value); } }
    const { BusinessRepository } = load('services/BusinessRepository.ets', {
      '@kit.CoreFileKit': { fileIo }, '@kit.ArkTS': { util: { TextEncoder: Encoder } },
      '../core/BusinessSync': rules, './PlatformErrors': platform
    });
    const a = new BusinessRepository(), b = new BusinessRepository();
    const initial = rules.newBusinessState(identity, 'device');
    const stateA = await a.load({ filesDir: '/private' }, initial);
    const stateB = await b.existing({ filesDir: '/private' });
    rules.enqueueBusinessMutation(stateA, mutation); await a.save(stateA);
    await assert.rejects(() => b.save(stateB), /已被更新/);
    assert.equal(JSON.parse(files.get('/private/hermes-eye-business-v1.json')).outbox.length, 1);
  });
  await test('invalid identity or protocol version cannot create a business replica', async () => {
    assert.throws(() => rules.newBusinessState({ ...identity, protocolVersion: 2 }, 'device'), /身份或协议无效/);
    assert.throws(() => rules.newBusinessState({ ...identity, serverId: '' }, 'device'), /身份或协议无效/);
    assert.throws(() => rules.newBusinessState({ ...identity, workspaceId: '' }, 'device'), /身份或协议无效/);
    assert.throws(() => rules.newBusinessState(identity, ''), /身份或协议无效/);
  });
  await test('every structural damage in a stored replica is rejected before it can be overwritten', async () => {
    const valid = () => rules.newBusinessState(identity, 'device');
    assert.throws(() => rules.validateBusinessState(null), /业务副本无效/);
    assert.throws(() => rules.validateBusinessState({ ...valid(), version: 2 }), /业务副本无效/);
    assert.throws(() => rules.validateBusinessState({ ...valid(), serverId: '' }), /业务副本无效/);
    assert.throws(() => rules.validateBusinessState({ ...valid(), workspaceId: '' }), /业务副本无效/);
    assert.throws(() => rules.validateBusinessState({ ...valid(), deviceId: '' }), /业务副本无效/);
    assert.throws(() => rules.validateBusinessState({ ...valid(), cursor: 1.5 }), /业务副本无效/);
    assert.throws(() => rules.validateBusinessState({ ...valid(), cursor: -1 }), /业务副本无效/);
    for (const key of ['entities', 'outbox', 'conflicts', 'operations']) {
      assert.throws(() => rules.validateBusinessState({ ...valid(), [key]: {} }), /业务副本无效/);
    }
    for (const patch of [{ id: '' }, { kind: '' }, { revision: 1.5 }, { revision: 0 }, { deleted: 'yes' }, { payload: null }]) {
      assert.throws(() => rules.validateBusinessState({ ...valid(), entities: [{ ...entity, ...patch }] }), /业务对象无效/);
    }
    const state = valid();
    assert.equal(rules.validateBusinessState(state), state);
  });
  await test('duplicate, conflicting or stale pending edits are refused before they join the outbox', async () => {
    const pending = rules.newBusinessState(identity, 'device');
    rules.enqueueBusinessMutation(pending, mutation);
    assert.throws(() => rules.enqueueBusinessMutation(pending, { ...mutation }), /已有待确认修改/);
    assert.throws(() => rules.enqueueBusinessMutation(pending, { ...mutation, mutationId: 'm2' }), /已有待确认修改/);
    assert.throws(() => rules.enqueueBusinessMutation(pending, { ...mutation, mutationId: '' }), /已有待确认修改/);
    assert.throws(() => rules.enqueueBusinessMutation(pending, { ...mutation, deviceId: 'other' }), /已有待确认修改/);
    assert.equal(pending.outbox.length, 1);
    const conflicted = rules.newBusinessState(identity, 'device');
    conflicted.conflicts.push({ local: mutation, remote: null });
    assert.throws(() => rules.enqueueBusinessMutation(conflicted, { ...mutation, mutationId: 'm3' }), /已有待确认修改/);
    assert.equal(conflicted.outbox.length, 0);
    const confirmed = rules.newBusinessState(identity, 'device');
    confirmed.entities.push({ ...entity, revision: 2 });
    assert.throws(() => rules.enqueueBusinessMutation(confirmed, { ...mutation, baseRevision: 1 }), /修改基线已过期/);
    rules.enqueueBusinessMutation(confirmed, { ...mutation, mutationId: 'm4', baseRevision: 2 });
    assert.equal(confirmed.outbox[0].baseRevision, 2);
  });
  await test('sync cursors reject non-integers, negatives and regressions while snapshots may rewind', async () => {
    const state = rules.newBusinessState(identity, 'device');
    assert.throws(() => rules.applyBusinessPage(state, { entities: [], cursor: 1.5 }), /同步游标无效/);
    assert.throws(() => rules.applyBusinessPage(state, { entities: [], cursor: -1 }), /同步游标无效/);
    rules.applyBusinessPage(state, { entities: [], cursor: 5 });
    assert.throws(() => rules.applyBusinessPage(state, { entities: [], cursor: 4 }), /同步游标无效/);
    assert.equal(state.cursor, 5);
    rules.applyBusinessPage(state, { entities: [], cursor: 0 }, true);
    assert.equal(state.cursor, 0);
  });
  await test('page merge keeps the newest revision and ignores older repetitions', async () => {
    const state = rules.newBusinessState(identity, 'device');
    rules.applyBusinessPage(state, { entities: [entity], cursor: 1 });
    rules.applyBusinessPage(state, { entities: [{ ...entity, revision: 2, payload: { title: 'newer' } }], cursor: 2 });
    assert.equal(state.entities.length, 1); assert.equal(state.entities[0].payload.title, 'newer');
    rules.applyBusinessPage(state, { entities: [{ ...entity, revision: 1, payload: { title: 'older' } }], cursor: 3 });
    assert.equal(state.entities[0].payload.title, 'newer');
  });
  await test('receipts either record a conflict or must acknowledge the exact next revision', async () => {
    const conflicted = rules.newBusinessState(identity, 'device');
    rules.enqueueBusinessMutation(conflicted, mutation);
    const remote = { ...entity, revision: 3, payload: { title: 'Remote' } };
    rules.applyBusinessReceipt(conflicted, mutation, { status: 'conflict', remote });
    assert.equal(conflicted.conflicts[0].remote.revision, 3); assert.equal(conflicted.outbox.length, 0);
    const absent = rules.newBusinessState(identity, 'device');
    rules.enqueueBusinessMutation(absent, mutation);
    rules.applyBusinessReceipt(absent, mutation, { status: 'conflict' });
    assert.equal(absent.conflicts[0].remote, null);
    const invalid = [{ status: 'accepted' }, { status: 'accepted', entity: { ...entity, id: 'other' } },
      { status: 'accepted', entity: { ...entity, kind: 'other' } }, { status: 'accepted', entity: { ...entity, revision: 5 } },
      { status: 'pending' }];
    for (const receipt of invalid) {
      const state = rules.newBusinessState(identity, 'device');
      rules.enqueueBusinessMutation(state, mutation);
      assert.throws(() => rules.applyBusinessReceipt(state, mutation, receipt), /业务确认回执无效/);
      assert.equal(state.outbox.length, 1);
    }
    const accepted = rules.newBusinessState(identity, 'device');
    rules.enqueueBusinessMutation(accepted, mutation);
    rules.applyBusinessReceipt(accepted, mutation, { status: 'accepted', entity });
    assert.equal(accepted.entities[0].revision, 1); assert.equal(accepted.outbox.length, 0);
  });
  await test('resolving a vanished conflict is refused and a null remote restarts from revision zero', async () => {
    const h = harness();
    await assert.rejects(() => h.coordinator.resolve('missing', true, 'm9'), /冲突已不存在/);
    const state = rules.newBusinessState(identity, 'device');
    state.conflicts.push({ local: { ...mutation }, remote: null });
    const nullRemote = new BusinessCoordinator(state, h.persistence, h.remote);
    await nullRemote.resolve('m1', true, 'm9');
    assert.equal(nullRemote.current().outbox[0].baseRevision, 0);
    assert.equal(nullRemote.current().conflicts.length, 0);
  });
  await test('snapshot rebuild replaces replicated entities while durable pending edits survive', async () => {
    const h = harness(); await h.coordinator.edit(mutation);
    h.remote.snapshot = async () => ({ entities: [{ ...entity, id: 'p2', payload: { title: 'Snapshot' } }], cursor: 0 });
    await h.coordinator.synchronize(true);
    assert.equal(h.saved().entities.some(item => item.payload.title === 'Snapshot'), true);
    assert.equal(h.saved().outbox.length, 0); assert.equal(h.saved().cursor, 5);
  });
  await test('a pull that reports more pages without advancing the cursor is refused', async () => {
    const h = harness();
    h.remote.pull = async cursor => ({ entities: [], cursor, hasMore: true });
    await assert.rejects(() => h.coordinator.synchronize(), /同步未推进/);
    assert.equal(h.coordinator.current().cursor, 0);
  });
  await test('a runaway pull chain stops at the page limit instead of looping forever', async () => {
    const h = harness();
    h.remote.pull = async cursor => ({ entities: [], cursor: cursor + 1, hasMore: true });
    await assert.rejects(() => h.coordinator.synchronize(), /页数已达上限/);
    assert.equal(h.coordinator.current().cursor, 100);
  });
  await test('a second operation on the same need is refused until the first one settles', async () => {
    const h = harness();
    const first = { operationId: 'o1', needId: 'n1', kind: 'chat', input: 'hello' };
    h.remote.submit = async () => { throw Error('lost'); };
    await assert.rejects(() => h.coordinator.send(first), /lost/);
    await assert.rejects(() => h.coordinator.send({ ...first, operationId: 'o2' }), /未确认操作/);
    const running = h.coordinator.current();
    running.operations[0].operation = { id: 'o1', needId: 'n1', kind: 'chat', state: 'running', remoteId: null, result: {} };
    await assert.rejects(() => new BusinessCoordinator(running, h.persistence, h.remote).send({ ...first, operationId: 'o3' }), /未确认操作/);
    running.operations[0].operation.state = 'completed';
    h.remote.submit = async intent => ({ id: intent.operationId, needId: intent.needId, kind: intent.kind, state: 'completed', remoteId: null, result: { message: 'done' } });
    const settled = await new BusinessCoordinator(running, h.persistence, h.remote).send({ ...first, operationId: 'o4' });
    assert.equal(settled.state, 'completed');
  });
  await test('a recovery reply that does not match the recorded intent is refused', async () => {
    const h = harness();
    h.remote.submit = async () => { throw Error('timeout'); };
    const intent = { operationId: 'o9', needId: 'n9', kind: 'chat', input: 'hello' };
    await assert.rejects(() => h.coordinator.send(intent), /timeout/);
    const mismatches = [{ id: 'other', needId: 'n9', kind: 'chat' }, { id: 'o9', needId: 'wrong', kind: 'chat' },
      { id: 'o9', needId: 'n9', kind: 'wrong' }];
    for (const patch of mismatches) {
      h.remote.query = async () => ({ ...patch, state: 'completed', remoteId: null, result: {} });
      await assert.rejects(() => h.coordinator.recover('o9'), /回执与原请求不符/);
    }
    await assert.rejects(() => h.coordinator.recover('missing'), /回执与原请求不符/);
    h.remote.query = async () => ({ id: 'o9', needId: 'n9', kind: 'chat', state: 'unknown', remoteId: null, result: {} });
    assert.equal((await h.coordinator.recover('o9')).state, 'unknown');
  });
  await test('business HTTP adapter maps every endpoint, verb, credential failure and transport failure', async () => {
    const seen = []; let status = 200; let failRequest = false;
    const http = {
      RequestMethod: { POST: 'POST', GET: 'GET' }, HttpDataType: { STRING: 'STRING' },
      createHttp() { return {
        async request(url, options) {
          if (failRequest) { throw Error('socket secret'); }
          seen.push({ url, method: options.method, body: options.extraData, auth: options.header.Authorization });
          return { responseCode: status, result: JSON.stringify({ ok: status }) };
        }, destroy() {}
      }; }
    };
    const { BusinessClient } = load('services/BusinessClient.ets', { '@kit.NetworkKit': { http }, '../core/Domain': load('core/Domain.ts') });
    const client = new BusinessClient('https://example.org/proxy', ' business-token ');
    const payload = async promise => JSON.parse(JSON.stringify(await promise));
    assert.deepEqual(await payload(client.mutate(mutation)), { ok: 200 });
    assert.deepEqual(await payload(client.pull(7)), { ok: 200 });
    assert.deepEqual(await payload(client.snapshot()), { ok: 200 });
    assert.deepEqual(await payload(client.submit({ operationId: 'o1', needId: 'n1', kind: 'chat', input: 'hi' })), { ok: 200 });
    assert.deepEqual(await payload(client.query('op 1/2')), { ok: 200 });
    assert.deepEqual(seen.map(item => item.url), ['https://example.org/proxy/eye/v1/mutations',
      'https://example.org/proxy/eye/v1/sync?cursor=7', 'https://example.org/proxy/eye/v1/snapshot',
      'https://example.org/proxy/eye/v1/operations', 'https://example.org/proxy/eye/v1/operations/op%201%2F2']);
    assert.deepEqual(seen.map(item => item.method), ['POST', 'GET', 'GET', 'POST', 'GET']);
    assert.equal(seen[0].auth, 'Bearer business-token'); assert.equal(seen[0].body, JSON.stringify(mutation));
    await assert.rejects(() => new BusinessClient('https://example.org/proxy', '   ').identity(), /独立的业务服务凭据/);
    status = 502; await assert.rejects(() => client.pull(0), /不要重复发送/);
    status = 200; failRequest = true;
    await assert.rejects(() => client.snapshot(), /不要重复发送/);
  });
  await test('reading adapter keeps collection, policy, question and answer requests separate', async () => {
    const requests = [];
    const http = { RequestMethod: { POST: 'POST', GET: 'GET' }, HttpDataType: { STRING: 'STRING' },
      createHttp() { return { async request(url, options) {
        requests.push({ url, method: options.method, body: options.extraData });
        return { responseCode: 200, result: '{}' };
      }, destroy() {} }; } };
    const { BusinessClient } = load('services/BusinessClient.ets', { '@kit.NetworkKit': { http }, '../core/Domain': load('core/Domain.ts') });
    const c = new BusinessClient('https://example.org', 'credential');
    await c.reading();
    const policy = { enabled: false, bookIds: ['book'], intervalHours: 24, timezone: 'Asia/Shanghai', consent: true };
    await c.readingPolicy(policy); await c.collectReading({ cycleId: 'cycle1' });
    await c.readingQuestion({ id: 'q1', bookId: 'book', entryId: 'e1', text: 'question' });
    await c.readingAnswer({ questionId: 'q1', operationId: 'o1', input: 'question' });
    assert.deepEqual(requests.map(r => r.url.split('/eye/v1')[1]),
      ['/reading', '/reading/policy', '/reading/collect', '/reading/questions', '/reading/answer']);
    assert.deepEqual(requests.map(r => r.method), ['GET', 'POST', 'POST', 'POST', 'POST']);
    assert.deepEqual(JSON.parse(requests[1].body), policy);
    assert.deepEqual(JSON.parse(requests[4].body), { questionId: 'q1', operationId: 'o1', input: 'question' });
  });
  function businessRepository(stage = '', code = 0) {
    const files = new Map();
    const control = { stage, code, writeCode: undefined, closeCode: undefined, closed: 0 };
    const codeOf = key => (control[key] === undefined ? control.code : control[key]);
    const failure = (message, failureCode) => Object.assign(new Error(message), { code: failureCode });
    const fileIo = {
      OpenMode: { CREATE: 1, WRITE_ONLY: 2, TRUNC: 4 },
      accessSync(path) {
        if (control.stage === 'access') { throw failure('access denied', control.code); }
        if (control.stage === 'accessMissing') { throw failure('missing file', control.code); }
        return files.has(path);
      },
      readTextSync(path) {
        if (control.stage === 'read') { throw failure('read failed', control.code); }
        return files.get(path);
      },
      openSync(path) {
        if (control.stage === 'open') { throw failure('open failed', control.code); }
        files.set(path, Buffer.alloc(0));
        return { fd: path };
      },
      writeSync(fd, buffer) {
        if (control.stage === 'write' || control.stage === 'writeClose') { throw failure('write failed', codeOf('writeCode')); }
        if (control.stage === 'zero') { return 0; }
        const bytes = Buffer.from(buffer);
        files.set(fd, Buffer.concat([files.get(fd) || Buffer.alloc(0), bytes]));
        return bytes.length;
      },
      fsyncSync() { if (control.stage === 'fsync') { throw failure('fsync failed', control.code); } },
      closeSync() {
        control.closed++;
        if (control.stage === 'close' || control.stage === 'writeClose') { throw failure('close failed', codeOf('closeCode')); }
      },
      renameSync(from, to) {
        if (control.stage === 'rename') { throw failure('rename failed', control.code); }
        files.set(to, files.get(from)); files.delete(from);
      }
    };
    class Encoder { encodeInto(value) { return new TextEncoder().encode(value); } }
    const platform = {
      platformCode(error) { return error && Number.isFinite(error.code) ? error.code : 0; },
      platformFailure(operation, error, advice) {
        const failureCode = error && Number.isFinite(error.code) ? error.code : 0;
        return Object.assign(new Error(`${advice}（${operation}，错误码 ${failureCode}）`), { code: failureCode });
      }
    };
    const { BusinessRepository } = load('services/BusinessRepository.ets', {
      '@kit.CoreFileKit': { fileIo }, '@kit.ArkTS': { util: { TextEncoder: Encoder } },
      '../core/BusinessSync': rules, './PlatformErrors': platform
    });
    return { files, control, repository: new BusinessRepository() };
  }
  await test('business storage failures map quota, access and unknown codes to distinct advice', async () => {
    const quota = businessRepository('open', 13900025);
    await assert.rejects(() => quota.repository.load({ filesDir: '/q' }, rules.newBusinessState(identity, 'device')), /配额/);
    const denied = businessRepository('access', 13900012);
    await assert.rejects(() => denied.repository.load({ filesDir: '/a' }, rules.newBusinessState(identity, 'device')), /不可访问或只读/);
    const other = businessRepository('read', 13900005);
    other.files.set('/o/hermes-eye-business-v1.json', '{}');
    await assert.rejects(() => other.repository.load({ filesDir: '/o' }, rules.newBusinessState(identity, 'device')), /原文件未被替换/);
  });
  await test('a missing business replica is created on first load and reported absent to readers', async () => {
    const h = businessRepository('accessMissing', 13900002);
    const loaded = await h.repository.load({ filesDir: '/new' }, rules.newBusinessState(identity, 'device'));
    assert.equal(loaded.deviceId, 'device');
    assert.equal(h.files.has('/new/hermes-eye-business-v1.json'), true);
    assert.equal(await h.repository.existing({ filesDir: '/other' }), undefined);
  });
  await test('an existing business replica is validated on read and damaged bytes are refused', async () => {
    const path = '/data/hermes-eye-business-v1.json';
    const h = businessRepository();
    h.files.set(path, JSON.stringify(rules.newBusinessState(identity, 'device')));
    const state = await h.repository.load({ filesDir: '/data' }, rules.newBusinessState(identity, 'device'));
    assert.equal(state.workspaceId, 'personal');
    assert.equal((await h.repository.existing({ filesDir: '/data' })).serverId, 'server');
    h.files.set(path, '{"version":2}');
    await assert.rejects(() => h.repository.existing({ filesDir: '/data' }), /业务副本无效/);
    await assert.rejects(() => h.repository.load({ filesDir: '/data' }, rules.newBusinessState(identity, 'device')), /业务副本无效/);
    const damaged = businessRepository();
    damaged.files.set(path, '{invalid');
    await assert.rejects(() => damaged.repository.load({ filesDir: '/data' }, rules.newBusinessState(identity, 'device')), /JSON/);
    await assert.rejects(() => damaged.repository.save(rules.newBusinessState(identity, 'device')), /尚未就绪/);
  });
  await test('business writes fail closed on short writes, stage errors, close errors and rename errors', async () => {
    const h = businessRepository();
    const state = await h.repository.load({ filesDir: '/w' }, rules.newBusinessState(identity, 'device'));
    const path = '/w/hermes-eye-business-v1.json';
    const original = h.files.get(path).toString();
    const stages = [{ stage: 'zero', pattern: /原文件未被替换/, operation: 'file.write' },
      { stage: 'write', code: 13900025, pattern: /配额/, operation: 'file.write' },
      { stage: 'fsync', code: 13900001, pattern: /不可访问或只读/, operation: 'file.fsync' },
      { stage: 'close', code: 13900008, pattern: /原文件未被替换/, operation: 'file.close' },
      { stage: 'rename', code: 13900027, pattern: /不可访问或只读/, operation: 'file.rename' }];
    for (const stage of stages) {
      h.control.stage = stage.stage; h.control.code = stage.code || 0;
      await assert.rejects(() => h.repository.save(state), error => stage.pattern.test(error.message) && error.message.includes(stage.operation));
      assert.equal(h.files.get(path).toString(), original);
    }
    h.control.stage = 'writeClose'; h.control.code = 0; h.control.writeCode = 13900025; h.control.closeCode = 13900008;
    await assert.rejects(() => h.repository.save(state), error => /13900025/.test(error.message) && /13900008/.test(error.message) && error.message.includes('；'));
    h.control.stage = '';
    await h.repository.save(state);
    assert.equal(JSON.parse(h.files.get(path).toString()).deviceId, 'device');
  });
  console.log(`\n${passed} business client tests passed; platform HTTP/persistence injected.`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
