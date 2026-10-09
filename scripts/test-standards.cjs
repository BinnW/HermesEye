#!/usr/bin/env node
'use strict';
/*
 * 规范门禁自身的单元测试（docs/15 §8.1 要求 scripts/check-standards.cjs 覆盖率 ≥90%）。
 *
 * 每条规则用一个最小 fixture 触发，断言规则 ID 出现；另有一个"合规 fixture"断言零发现。
 * CLI 分支（--help/--list-rules/未知参数/--json/默认仓库扫描）用子进程覆盖。
 *
 * 运行：node scripts/test-standards.cjs
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { scan, mask, splitArguments, lineAt, RULES } = require('./check-standards.cjs');

const NODE = process.execPath;
const CHECKER = path.join(__dirname, 'check-standards.cjs');
let passed = 0;
function test(name, action) {
  action();
  passed++;
  console.log('PASS ' + name);
}

const LOGGING = [
  "export const LOG_DOMAIN: number = 0x1200;",
  'export class LogTag {',
  "  static readonly Ability: string = 'Ability';",
  "  static readonly Platform: string = 'Platform';",
  '}',
  '',
].join('\n');
const HILOG_IMPORTS = "import { hilog } from '@kit.PerformanceAnalysisKit';\n" +
  "import { LOG_DOMAIN, LogTag } from './Logging';\n";

function fixture(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hermeseye-standards-'));
  const withRegistry = { 'entry/src/main/ets/services/Logging.ets': LOGGING, ...files };
  for (const [relative, content] of Object.entries(withRegistry)) {
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  return root;
}
function purge(root) {
  fs.rmSync(root, { recursive: true, force: true });
}
function findingsOf(files) {
  const root = fixture(files);
  try {
    return scan(root).findings;
  } finally {
    purge(root);
  }
}
function rulesOf(files) {
  return findingsOf(files).map(finding => finding.rule);
}
function assertRule(rule, files, message) {
  const rules = rulesOf(files);
  assert.ok(rules.includes(rule), `${message || rule}: expected ${rule} in ${JSON.stringify(rules)}`);
}
function assertNoRule(rule, files) {
  const rules = rulesOf(files);
  assert.ok(!rules.includes(rule), `expected no ${rule}, got ${JSON.stringify(rules)}`);
}

// ---------------------------------------------------------------- 合规基线
test('a compliant tree produces no findings', () => {
  const findings = findingsOf({
    'entry/src/main/ets/services/Good.ets': HILOG_IMPORTS +
      'export class Good {\n' +
      '  run(count: number): void {\n' +
      "    hilog.info(LOG_DOMAIN, LogTag.Ability, '处理完成，条数=%{public}d', count);\n" +
      '  }\n' +
      '}\n',
    'entry/src/main/ets/core/Rules.ts': 'export function add(left: number, right: number): number {\n  return left + right;\n}\n',
    'backend/service.py': "import logging\nlogger = logging.getLogger('service')\n\ndef run():\n    logger.info('started')\n",
  });
  assert.deepEqual(findings, [], JSON.stringify(findings));
});

// ---------------------------------------------------------------- CS 系列
test('CS-01 core importing a platform kit is rejected', () => {
  assertRule('CS-01', { 'entry/src/main/ets/core/Bad.ts': "import { util } from '@kit.ArkTS';\nexport function f(): number { return 1; }\n" });
  assertRule('CS-01', { 'entry/src/main/ets/core/Bad2.ts': "import { x } from '../services/Logging';\nexport const y = x;\n" });
});
test('CS-02 ArkUI decorators outside UI layers are rejected', () => {
  assertRule('CS-02', { 'entry/src/main/ets/services/Bad.ets': 'export class Bad {\n  @State value: number = 1;\n}\n' });
  assertNoRule('CS-02', { 'entry/src/main/ets/components/Ok.ets': '@Component\nexport struct Ok {\n  @State value: number = 1;\n  build() {}\n}\n' });
});
test('CS-03 AssetStoreKit is confined to CredentialStore', () => {
  assertRule('CS-03', { 'entry/src/main/ets/services/AssetUse.ets': "import { asset } from '@kit.AssetStoreKit';\nexport const store = asset;\n" });
  assertNoRule('CS-03', { 'entry/src/main/ets/services/CredentialStore.ets': "import { asset } from '@kit.AssetStoreKit';\nexport const store = asset;\n" });
});
test('CS-04 any/unknown is rejected and normal words are not', () => {
  assertRule('CS-04', { 'entry/src/main/ets/core/AnyUse.ts': 'export function f(value: any): string { return String(value); }\n' });
  assertRule('CS-04', { 'entry/src/main/ets/core/UnknownUse.ts': 'export function f(value: unknown): string { return String(value); }\n' });
  assertNoRule('CS-04', { 'entry/src/main/ets/core/Company.ts': 'export const company = 1;\n' });
});
test('CS-05 Function type is rejected', () => {
  assertRule('CS-05', { 'entry/src/main/ets/core/FnType.ts': 'export const handler: Function = () => 1;\n' });
});
test('CS-06 namespace/require/eval/prototype are rejected', () => {
  assertRule('CS-06', { 'entry/src/main/ets/core/Namespace.ts': 'namespace Inner {\n  export const value = 1;\n}\nexport const x = Inner.value;\n' });
  assertRule('CS-06', { 'entry/src/main/ets/core/Prototype.ts': 'export const has = Object.prototype.hasOwnProperty;\n' });
  assertRule('CS-06', { 'entry/src/main/ets/core/Require.ts': 'export const loaded = require("x");\n' });
});
test('CS-07 single-struct file name must match the struct', () => {
  assertRule('CS-07', { 'entry/src/main/ets/components/Wrong.ets': '@Component\nexport struct OtherName {\n  build() {}\n}\n' });
  assertNoRule('CS-07', { 'entry/src/main/ets/components/Match.ets': '@Component\nexport struct Match {\n  build() {}\n}\n' });
  assertNoRule('CS-07', { 'entry/src/main/ets/services/Constants.ets': 'export class Tags {\n  static readonly A: string = \'A\';\n}\n' });
});
test('CS-08 hardcoded hex colors in UI files are rejected', () => {
  assertRule('CS-08', { 'entry/src/main/ets/components/Colors.ets': "@Component\nexport struct Colors {\n  build() {\n    Text('x').fontColor('#FF0000');\n  }\n}\n" });
  assertNoRule('CS-08', { 'entry/src/main/ets/components/Semantic.ets': "@Component\nexport struct Semantic {\n  build() {\n    Text('x').fontColor($r('app.color.text_primary'));\n  }\n}\n" });
});
test('CS-09 tabs and CS-17 long lines are reported', () => {
  assertRule('CS-09', { 'entry/src/main/ets/services/Tab.ets': 'export const a = 1;\n\texport const b = 2;\n' });
  assertRule('CS-17', { 'entry/src/main/ets/services/Long.ets': 'export const long = ' + '1 + '.repeat(60) + '1;\n' });
});
test('CS-10 double quotes and CS-11 missing trailing newline are reported', () => {
  assertRule('CS-10', { 'entry/src/main/ets/services/Quotes.ets': 'export const label = "double";\n' });
  const findings = findingsOf({ 'entry/src/main/ets/services/NoNewline.ets': 'export const a = 1;' });
  assert.ok(findings.some(finding => finding.rule === 'CS-11'), JSON.stringify(findings));
});
test('CS-12 $r inside stateStyles is flagged as the known crash pattern', () => {
  assertRule('CS-12', {
    'entry/src/main/ets/components/Styles.ets': '@Component\nexport struct Styles {\n  build() {\n' +
      "    Text('x').stateStyles({ pressed: { .backgroundColor($r('app.color.selection_bg')) } });\n  }\n}\n",
  });
});
test('CS-13 unregistered test files are rejected', () => {
  assertRule('CS-13', {
    'entry/src/test/List.test.ets': "import localUnitTest from './LocalUnit.test';\n\nexport default function testsuite() {\n  localUnitTest();\n}\n",
    'entry/src/test/LocalUnit.test.ets': "import { describe, it } from '@ohos/hypium';\n\nexport default function t() {\n  describe('x', () => {\n    it('works', 0, () => {});\n  });\n}\n",
    'entry/src/test/Unregistered.test.ets': "import { describe, it } from '@ohos/hypium';\n\nexport default function t() {\n  describe('y', () => {\n    it('works', 0, () => {});\n  });\n}\n",
  });
  assertRule('CS-13', {
    'entry/src/ohosTest/ets/test/List.test.ets': 'export default function testsuite() {}\n',
    'entry/src/ohosTest/ets/test/Device.test.ets': 'export default function t() {}\n',
  });
});
test('CS-14 .only() and missing Hypium level are rejected', () => {
  assertRule('CS-14', {
    'entry/src/test/List.test.ets': "import localUnitTest from './LocalUnit.test';\n\nexport default function testsuite() {\n  localUnitTest();\n}\n",
    'entry/src/test/LocalUnit.test.ets': "import { describe, it } from '@ohos/hypium';\n\nexport default function t() {\n  describe('x', () => {\n    it.only('focused', 0, () => {});\n    it('no level', () => {});\n  });\n}\n",
  });
});
test('CS-15 credential-looking literals are rejected', () => {
  assertRule('CS-15', { 'entry/src/main/ets/services/Secret.ets': "export const token = 'sk-abcdefghijklmnop1234';\n" });
  assertRule('CS-15', { 'entry/src/main/ets/services/Secret2.ets': "export const header = 'Bearer abcdefghijklmnopqrstuvwx';\n" });
  assertNoRule('CS-15', { 'entry/src/test/LocalUnit.test.ets': "export const token = 'sk-abcdefghijklmnop1234';\n" });
});
test('CS-16 TODO without a date is reported', () => {
  assertRule('CS-16', { 'entry/src/main/ets/services/Todo.ets': '// TODO: 以后处理\nexport const a = 1;\n' });
  assertNoRule('CS-16', { 'entry/src/main/ets/services/Todo2.ets': '// TODO(2026-10-07, 张三): 以后处理\nexport const a = 1;\n' });
});

// ---------------------------------------------------------------- LOG 系列
test('LOG-01 hilog without arguments is rejected', () => {
  assertRule('LOG-01', { 'entry/src/main/ets/services/Call.ets': HILOG_IMPORTS + 'export function f(): void {\n  hilog.info();\n}\n' });
});
test('LOG-02 non-registry domains are rejected and a missing registry is reported', () => {
  assertRule('LOG-02', { 'entry/src/main/ets/services/Call.ets': HILOG_IMPORTS + "export function f(): void {\n  hilog.info(0x0000, LogTag.Ability, 'x');\n}\n" });
  assertRule('LOG-02', { 'entry/src/main/ets/services/Call.ets': HILOG_IMPORTS + "export function f(): void {\n  hilog.info(DOMAIN, LogTag.Ability, 'x');\n}\n" });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hermeseye-standards-'));
  try {
    const target = path.join(root, 'entry/src/main/ets/services/Call.ets');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, "import { hilog } from '@kit.PerformanceAnalysisKit';\nexport function f(): void { hilog.info(1, 't', 'x'); }\n");
    const findings = scan(root).findings;
    assert.ok(findings.some(finding => finding.rule === 'LOG-02' && /Logging\.ets 缺失/.test(finding.message)), JSON.stringify(findings));
  } finally {
    purge(root);
  }
});
test('LOG-03 unregistered or non-constant tags are rejected', () => {
  assertRule('LOG-03', { 'entry/src/main/ets/services/Call.ets': HILOG_IMPORTS + "export function f(): void {\n  hilog.info(LOG_DOMAIN, LogTag.Missing, 'x');\n}\n" });
  assertRule('LOG-03', { 'entry/src/main/ets/services/Call.ets': HILOG_IMPORTS + "export function f(): void {\n  hilog.info(LOG_DOMAIN, 'testTag', 'x');\n}\n" });
});
test('LOG-04 non-literal and empty messages are rejected', () => {
  assertRule('LOG-04', { 'entry/src/main/ets/services/Call.ets': HILOG_IMPORTS + 'export function f(name: string): void {\n  hilog.info(LOG_DOMAIN, LogTag.Ability, `长度 ${name}`);\n}\n' });
  assertRule('LOG-04', { 'entry/src/main/ets/services/Call.ets': HILOG_IMPORTS + "export function f(name: string): void {\n  hilog.info(LOG_DOMAIN, LogTag.Ability, 'name: ' + name);\n}\n" });
  assertRule('LOG-04', { 'entry/src/main/ets/services/Call.ets': HILOG_IMPORTS + "export function f(): void {\n  hilog.info(LOG_DOMAIN, LogTag.Ability, '   ');\n}\n" });
});
test('LOG-05 bare placeholders and placeholder/argument mismatches are rejected', () => {
  assertRule('LOG-05', { 'entry/src/main/ets/services/Call.ets': HILOG_IMPORTS + "export function f(count: number): void {\n  hilog.info(LOG_DOMAIN, LogTag.Ability, '条数=%d', count);\n}\n" });
  assertRule('LOG-05', { 'entry/src/main/ets/services/Call.ets': HILOG_IMPORTS + "export function f(count: number): void {\n  hilog.info(LOG_DOMAIN, LogTag.Ability, '条数=%{public}d 状态=%{public}s', count);\n}\n" });
});
test('LOG-06 sensitive arguments must be private', () => {
  assertRule('LOG-06', { 'entry/src/main/ets/services/Call.ets': HILOG_IMPORTS + "export function f(token: string): void {\n  hilog.info(LOG_DOMAIN, LogTag.Ability, '令牌=%{public}s', token);\n}\n" });
  assertNoRule('LOG-06', { 'entry/src/main/ets/services/Call.ets': HILOG_IMPORTS + "export function f(token: string): void {\n  hilog.info(LOG_DOMAIN, LogTag.Ability, '令牌=%{private}s', token);\n}\n" });
});
test('LOG-07 console calls are rejected', () => {
  assertRule('LOG-07', { 'entry/src/main/ets/services/Call.ets': "export function f(): void {\n  console.log('x');\n}\n" });
});
test('LOG-08 hilog without the Logging import is rejected', () => {
  assertRule('LOG-08', { 'entry/src/main/ets/services/Call.ets': "import { hilog } from '@kit.PerformanceAnalysisKit';\nexport function f(): void {\n  hilog.info(LOG_DOMAIN, LogTag.Ability, 'x');\n}\n" });
});
test('LOG-09 raw error objects and stacks are rejected', () => {
  assertRule('LOG-09', { 'entry/src/main/ets/services/Call.ets': HILOG_IMPORTS + "export function f(error: Error): void {\n  hilog.error(LOG_DOMAIN, LogTag.Ability, '失败=%{public}s', JSON.stringify(error));\n}\n" });
  assertRule('LOG-09', { 'entry/src/main/ets/services/Call.ets': HILOG_IMPORTS + "export function f(error: Error): void {\n  hilog.error(LOG_DOMAIN, LogTag.Ability, '失败=%{public}s', error.message);\n}\n" });
  assertNoRule('LOG-09', { 'entry/src/main/ets/services/Call.ets': HILOG_IMPORTS + "export function f(code: number): void {\n  hilog.error(LOG_DOMAIN, LogTag.Ability, '失败=%{public}d', code);\n}\n" });
});
test('LOG-10 logging inside build() is rejected', () => {
  assertRule('LOG-10', {
    'entry/src/main/ets/components/Chatty.ets': HILOG_IMPORTS + '@Component\nexport struct Chatty {\n  build() {\n' +
      "    hilog.info(LOG_DOMAIN, LogTag.Ability, '渲染');\n  }\n}\n",
  });
});

// ---------------------------------------------------------------- Python 系列
test('PY-01/PY-02/PY-03/PY-04 backend logging rules', () => {
  const rules = rulesOf({
    'backend/bare.py': 'def run():\n    try:\n        pass\n    except:\n        pass\n',
    'backend/swallow.py': 'def run():\n    try:\n        pass\n    except Exception:\n        pass\n',
    'backend/narrow.py': 'def run():\n    try:\n        pass\n    except ValueError:\n        pass\n',
    'backend/printy.py': 'def run():\n    print("x")\n',
  });
  for (const rule of ['PY-01', 'PY-02', 'PY-03', 'PY-04']) {
    assert.ok(rules.includes(rule), `expected ${rule} in ${JSON.stringify(rules)}`);
  }
  assertNoRule('PY-04', { 'backend/ok.py': 'def run():\n    return 1\n' });
});
test('LOG-06 backend logger must not name sensitive fields', () => {
  assertRule('LOG-06', {
    'backend/leaky.py': "import logging\nlogger = logging.getLogger('x')\n\ndef run(token):\n    logger.info(f'using token {token}')\n",
  });
  assertNoRule('LOG-06', {
    'backend/quiet.py': "import logging\nlogger = logging.getLogger('x')\n\ndef run(count):\n    logger.info('count %s', count)\n",
  });
});

// ---------------------------------------------------------------- 辅助函数
test('mask removes comments and strings but keeps offsets and newlines', () => {
  const source = "const a = 'x)y';\n// )\n/* ) */\nconst b = \"(\";\n";
  const masked = mask(source);
  assert.equal(masked.length, source.length);
  assert.equal(masked.split('\n').length, source.split('\n').length);
  assert.ok(!masked.includes(')'));
  assert.ok(masked.includes('const a ='));
});
test('mask handles escaped quotes and template literals', () => {
  const source = "const a = 'it\\'s';\nconst b = `it( ${a} )`;\n";
  const masked = mask(source);
  assert.equal(masked.length, source.length);
  assert.ok(!masked.includes('it('));
});
test('splitArguments respects nesting and only splits at top level', () => {
  const source = 'f(1, g(2, 3), [4, 5])';
  assert.deepEqual(splitArguments(source, mask(source), 2, source.lastIndexOf(')')), ['1', 'g(2, 3)', '[4, 5]']);
  assert.deepEqual(splitArguments('f()', mask('f()'), 2, 2), []);
});
test('lineAt returns the 1-based line of an offset', () => {
  const source = 'a\nb\nc';
  assert.equal(lineAt(source, 0), 1);
  assert.equal(lineAt(source, 2), 2);
  assert.equal(lineAt(source, 4), 3);
});
test('every finding carries a registered rule id and severity', () => {
  const known = new Set(RULES.map(rule => rule[0]));
  const findings = findingsOf({ 'entry/src/main/ets/services/Bad.ets': "import { hilog } from '@kit.PerformanceAnalysisKit';\nexport function f(): void { hilog.info(0x0000, 'testTag', 1); }\n" });
  assert.ok(findings.length > 0);
  for (const finding of findings) {
    assert.ok(known.has(finding.rule), 'unregistered rule ' + finding.rule);
    assert.ok(finding.severity === 'error' || finding.severity === 'warn');
  }
});

// ---------------------------------------------------------------- CLI 分支
test('CLI --list-rules prints every rule and --help prints usage', () => {
  const listed = spawnSync(NODE, [CHECKER, '--list-rules'], { encoding: 'utf8' });
  assert.equal(listed.status, 0);
  for (const [id] of RULES) assert.ok(listed.stdout.includes(id), 'missing ' + id);
  const help = spawnSync(NODE, [CHECKER, '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0);
  assert.ok(help.stdout.includes('usage:'));
});
test('CLI rejects unknown arguments with exit code 2', () => {
  const result = spawnSync(NODE, [CHECKER, '--nope'], { encoding: 'utf8' });
  assert.equal(result.status, 2);
  assert.ok(result.stderr.includes('unknown argument'));
});
test('CLI scans the real repository and writes a JSON report', () => {
  const output = path.join(os.tmpdir(), `hermeseye-standards-${process.pid}.json`);
  const result = spawnSync(NODE, [CHECKER, '--json', output], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const report = JSON.parse(fs.readFileSync(output, 'utf8'));
  assert.equal(report.errors, 0);
  assert.ok(report.scannedFiles > 10);
  assert.ok(Array.isArray(report.rules) && report.rules.length === RULES.length);
  fs.rmSync(output, { force: true });
});
test('CLI --quiet stays silent when the repository is clean', () => {
  const result = spawnSync(NODE, [CHECKER, '--quiet'], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), '');
});

console.log(`\n${passed} standards gate tests passed; checker rules and CLI covered.`);
