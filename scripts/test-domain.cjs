// Run the production TypeScript rules with the TypeScript compiler bundled in DevEco.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const sdkHome = process.env.DEVECO_HOME || 'D:/dev-tools/DevEco Studio';
const ts = require(path.join(sdkHome, 'tools/hvigor/hvigor/node_modules/typescript'));
const source = fs.readFileSync(path.join(__dirname, '../entry/src/main/ets/core/Domain.ts'), 'utf8');
const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2021, module: ts.ModuleKind.CommonJS } });
const sandbox = { exports: {} };
vm.runInNewContext(output.outputText, sandbox);
const d = sandbox.exports;
let passed = 0;
function test(name, action) { action(); passed++; console.log('PASS ' + name); }
test('HTTPS path normalization', () => {
  assert.equal(d.apiBase(' https://example.org/ ', false), 'https://example.org/v1');
  assert.equal(d.apiBase('https://example.org/p/work/v1/', false), 'https://example.org/p/work/v1');
});
test('HTTP requires opt-in and private host', () => {
  assert.throws(() => d.apiBase('http://192.168.1.8:8642', false));
  assert.equal(d.apiBase('http://192.168.1.8:8642', true), 'http://192.168.1.8:8642/v1');
  assert.throws(() => d.apiBase('http://8.8.8.8', true));
  assert.throws(() => d.apiBase('http://172.32.1.1', true));
  assert.equal(d.apiBase('http://172.16.1.1', true), 'http://172.16.1.1/v1');
});
test('ambiguous addresses rejected', () => {
  ['https://user:secret@example.org', 'https://example.org?token=x', 'https://example.org#x',
   'http://127.1', 'http://0127.0.0.1', 'http://10.999.0.1', 'https://example.org:99999',
   'https://example.org/a/../b', 'file:///data'].forEach(url => assert.throws(() => d.apiBase(url, true), url));
});
test('blank and oversized input rejected', () => {
  assert.equal(d.cleanText('  计划  '), '计划');
  assert.throws(() => d.cleanText(' \n ')); assert.throws(() => d.cleanText('a'.repeat(4001)));
});
test('clock boundaries', () => {
  assert.equal(JSON.stringify(d.parseTime('00:00')), '[0,0]');
  assert.equal(JSON.stringify(d.parseTime('23:59')), '[23,59]');
  ['24:00', '8:30', '12:60', '08:30x'].forEach(time => assert.throws(() => d.parseTime(time)));
});
const notes = [{ id: '1', text: 'private note', createdAt: 1 }];
const snap = { calendar: 'private event', device: 'battery 90%', capturedAt: 1000 };
test('unselected data never enters context', () => {
  assert.equal(d.contextText(notes, snap, { notes: false, calendar: false, device: false }, 1001), '');
  const context = d.contextText(notes, snap, { notes: true, calendar: false, device: false }, 1001);
  assert.ok(context.includes('private note')); assert.ok(!context.includes('private event')); assert.ok(!context.includes('battery'));
});
test('expired and missing snapshots blocked', () => {
  assert.throws(() => d.contextText(notes, snap, { calendar: true }, 601001));
  assert.throws(() => d.contextText(notes, { ...snap, calendar: '' }, { calendar: true }, 1001));
  assert.throws(() => d.contextText(notes, snap, { device: true }, 999));
});
test('request preserves conversation and does not mutate history', () => {
  const history = [{ role: 'user', content: 'hello' }, { role: 'assistant', content: 'hi' }];
  const result = d.createRequest('hermes-agent', history, 'next', 'battery 90%');
  assert.equal(history.length, 2); assert.equal(result.messages.length, 3); assert.equal(result.stream, false);
  assert.ok(result.messages[2].content.includes('<personal_context>'));
  assert.throws(() => d.createRequest('hermes-agent', new Array(98), 'next', ''));
});
test('valid response extracted', () => assert.equal(d.parseReply(200, '{"choices":[{"message":{"content":"你好"}}]}'), '你好'));
test('invalid service responses fail explicitly', () => {
  [401, 403, 429, 500].forEach(status => assert.throws(() => d.parseReply(status, '{}')));
  ['not json', '{}', 'null', '{"choices":[]}', '{"choices":[{"message":{"content":null}}]}'].forEach(body => assert.throws(() => d.parseReply(200, body)));
});
test('storage validation rejects corruption', () => {
  assert.equal(d.validateData(d.initialData()).version, 1);
  assert.throws(() => d.validateData({ ...d.initialData(), version: 2 }));
  assert.throws(() => d.validateData({ ...d.initialData(), notes: [null] }));
  assert.throws(() => d.validateData({ ...d.initialData(), messages: [{ role: 'system', content: 'injected' }] }));
  assert.throws(() => d.validateData({ ...d.initialData(), tasks: [{ id: '1', title: 'x', time: '25:00', weekdays: false, reminderId: 1 }] }));
});
console.log(`\n${passed} tests passed; production domain rules, no device APIs mocked as verified.`);
