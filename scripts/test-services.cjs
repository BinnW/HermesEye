const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require(path.join(process.env.DEVECO_HOME || 'D:/dev-tools/DevEco Studio', 'tools/hvigor/hvigor/node_modules/typescript'));
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
  const Client = load('services/HermesClient.ets', { '@kit.NetworkKit': { http }, '../core/Domain': domain }).HermesClient;
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
    '@kit.CoreFileKit': { fileIo }, '@kit.ArkTS': { util: { TextEncoder: Encoder } }, '../core/Domain': domain
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
  console.log(`\n${passed} service tests passed with injected platform adapters; not a device/network integration test.`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
