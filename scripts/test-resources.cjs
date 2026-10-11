#!/usr/bin/env node
'use strict';
/*
 * 资源完整性自动化用例。
 *
 * 本轮新增了 200 余条 string 资源；$r('app.string.xxx') 写错名字在 ArkTS 编译期不一定
 * 报错、真机才表现为空白或崩溃，因此单独加一道无设备可跑的检查：
 *   1. 代码里引用的 app.string / app.color 必须存在于资源文件；
 *   2. 引用的 app.color 必须同时存在于 base 与 dark（项目规范：语义色成对登记）；
 *   3. 资源文件内部不得重名，结构必须是 { string|color: [{ name, value }] }；
 *   4. 未被任何代码引用的 string 只报告不失败（可能是预留给后续页面）。
 *
 * 用法：node scripts/test-resources.cjs [--verbose]
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const ETS_DIRS = [path.join(ROOT, 'entry/src/main/ets'), path.join(ROOT, 'AppScope')];
const RESOURCE_FILES = {
  string: [
    path.join(ROOT, 'entry/src/main/resources/base/element/string.json'),
    path.join(ROOT, 'AppScope/resources/base/element/string.json'),
  ],
  color: [
    path.join(ROOT, 'entry/src/main/resources/base/element/color.json'),
    path.join(ROOT, 'entry/src/main/resources/dark/element/color.json'),
    path.join(ROOT, 'AppScope/resources/base/element/color.json'),
    path.join(ROOT, 'AppScope/resources/dark/element/color.json'),
  ],
};
const verbose = process.argv.includes('--verbose');
const failures = [];
let checks = 0;

function check(condition, message) {
  checks++;
  if (!condition) failures.push(message);
}

function readResourceFile(file) {
  if (!fs.existsSync(file)) return null;
  const text = fs.readFileSync(file, 'utf8');
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    failures.push(`${path.relative(ROOT, file)} 不是合法 JSON：${error.message}`);
    return null;
  }
  const kind = Object.keys(parsed).find((key) => Array.isArray(parsed[key]));
  check(Boolean(kind), `${path.relative(ROOT, file)} 缺少 string/color 数组`);
  if (!kind) return { kind: 'unknown', entries: new Map() };
  const entries = new Map();
  for (const item of parsed[kind]) {
    check(typeof item.name === 'string' && item.name.length > 0, `${path.relative(ROOT, file)} 存在缺少 name 的条目`);
    check(typeof item.value === 'string', `${path.relative(ROOT, file)} 的 ${item.name} 缺少字符串 value`);
    check(!entries.has(item.name), `${path.relative(ROOT, file)} 重复定义 ${item.name}`);
    entries.set(item.name, item.value);
  }
  return { kind, entries };
}

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (/^(build|\.test|\.preview|node_modules|oh_modules|resources)$/.test(entry.name)) return [];
      return walk(full);
    }
    return /\.(ts|ets)$/.test(entry.name) ? [full] : [];
  });
}

const resources = { string: new Map(), color: new Map(), colorFiles: new Map() };
for (const [kind, files] of Object.entries(RESOURCE_FILES)) {
  for (const file of files) {
    const parsed = readResourceFile(file);
    if (!parsed) continue;
    resources.colorFiles.set(file, parsed.entries.size);
    for (const [name, value] of parsed.entries) {
      if (!resources[kind].has(name)) resources[kind].set(name, { value, files: [] });
      resources[kind].get(name).files.push(path.relative(ROOT, file));
    }
  }
}

// 代码与配置引用；允许带格式化参数（$r('app.string.x', value)），也扫描 module.json5 等配置。
const referenced = { string: new Map(), color: new Map() };
const referencePattern = /\$r\(\s*'app\.(string|color)\.([A-Za-z0-9_]+)'/g;
// 配置文件用 $string:Name / $color:Name 语法
const configPattern = /\$(string|color):([A-Za-z0-9_]+)/g;
const CONFIG_FILES = [
  path.join(ROOT, 'entry/src/main/module.json5'),
  path.join(ROOT, 'AppScope/app.json5'),
  path.join(ROOT, 'entry/src/main/ets/entryability/EntryAbility.ets'),
];
let scannedFiles = 0;
const sources = [...ETS_DIRS.flatMap(walk), ...CONFIG_FILES.filter((file) => fs.existsSync(file))];
for (const file of sources) {
  scannedFiles++;
  const text = fs.readFileSync(file, 'utf8');
  let match;
  while ((match = referencePattern.exec(text)) !== null) {
    const kind = match[1];
    const name = match[2];
    if (!referenced[kind].has(name)) referenced[kind].set(name, []);
    referenced[kind].get(name).push(path.relative(ROOT, file));
  }
  configPattern.lastIndex = 0;
  while ((match = configPattern.exec(text)) !== null) {
    const kind = match[1];
    const name = match[2];
    if (!referenced[kind].has(name)) referenced[kind].set(name, []);
    referenced[kind].get(name).push(path.relative(ROOT, file));
  }
}

// 1+2. 引用必须存在；颜色必须 base/dark 成对
for (const kind of ['string', 'color']) {
  for (const [name, files] of referenced[kind]) {
    const entry = resources[kind].get(name);
    check(Boolean(entry), `代码引用了不存在的 app.${kind}.${name}（${files[0]}）`);
    if (entry && kind === 'color') {
      const hasBase = entry.files.some((file) => file.includes('/base/'));
      const hasDark = entry.files.some((file) => file.includes('/dark/'));
      check(hasBase && hasDark, `app.color.${name} 未同时登记 base 与 dark（当前：${entry.files.join(', ')}）`);
    }
  }
}

// 4. 未被引用的 string（只报告）
const unusedStrings = [...resources.string.keys()].filter((name) => !referenced.string.has(name)).sort();
const unusedColors = [...resources.color.keys()].filter((name) => !referenced.color.has(name)).sort();

const summary = [
  `扫描 ${scannedFiles} 个源文件`,
  `string 资源 ${resources.string.size} 条，被引用 ${referenced.string.size} 条，未引用 ${unusedStrings.length} 条`,
  `color 资源 ${resources.color.size} 条（base/dark 合并），被引用 ${referenced.color.size} 条，未引用 ${unusedColors.length} 条`,
].join('；');
console.log(`资源完整性检查：${summary}`);
if (verbose) {
  if (unusedStrings.length) console.log(`未引用的 string：${unusedStrings.join(', ')}`);
  if (unusedColors.length) console.log(`未引用的 color：${unusedColors.join(', ')}`);
}

if (failures.length > 0) {
  console.error(`\n资源完整性检查失败（${failures.length} 项，共 ${checks} 次断言）：`);
  for (const failure of failures) console.error('  - ' + failure);
  process.exit(1);
}
console.log(`\n${checks} 项资源断言通过；string/color 引用与 base-dark 配对一致。`);
