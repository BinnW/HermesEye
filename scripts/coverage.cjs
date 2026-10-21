#!/usr/bin/env node
'use strict';
/*
 * 分支/块覆盖率门禁。
 *
 * 四套 Node 用例都在 vm 里执行转译后的生产代码，因此可以用 V8 的精确块覆盖
 * （NODE_V8_COVERAGE）直接量出 core/ 与 services/ 的未执行函数与未覆盖分支——
 * 不需要额外插桩，也不需要网络依赖。
 *
 * 用法：
 *   node scripts/coverage.cjs                 # 表格 + 未覆盖清单，未达下限时退出码 1
 *   node scripts/coverage.cjs --verbose       # 打印全部未覆盖分支
 *   node scripts/coverage.cjs --json out.json # 机读报告
 *   node scripts/coverage.cjs --no-fail       # 只报告不失败（排查用）
 *
 * 依赖：用例通过 vm.runInNewContext(code, sandbox, { filename }) 登记生产文件路径，
 * 否则 V8 无法把覆盖归到文件；本脚本用与用例相同的 compilerOptions 重新转译并解析
 * source map，把行号映射回源码（TS 会省略纯类型行，不能用生成行号直接当源码行号）。
 * 行/块口径与下限见 docs/design/15-coding-standard.md §8.1。
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { fileURLToPath } = require('node:url');
const { loadTypescript } = require('./lib/deveco-env.cjs');

const ROOT = path.resolve(__dirname, '..');
const MAIN_DIR = path.join(ROOT, 'entry/src/main/ets');
const GATE_DIR = path.join(ROOT, 'scripts');
const SUITES = ['test-standards.cjs', 'test-domain.cjs', 'test-services.cjs', 'test-workspace.cjs', 'test-business.cjs', 'test-ui-flows.cjs'];
const FLOORS = [
  { label: 'core', pattern: /entry\/src\/main\/ets\/core\/[^/]+\.ts$/, lines: 100, blocks: 100 },
  { label: 'services', pattern: /entry\/src\/main\/ets\/services\/[^/]+\.ets$/, lines: 95, blocks: 90 },
  { label: 'gate', pattern: /scripts\/check-standards\.cjs$/, lines: 90, blocks: 90 },
];
// pages/Index.ets 由 test-workspace.cjs 以"抽取方法"方式加载（class Harness {...}），
// 生成代码与真实文件不同，行号不可信；UI 由源结构守卫与设备用例覆盖，不计入覆盖率。
const SKIP_FILES = [/entry\/src\/main\/ets\/pages\//];
const MAX_REPORTED = 30;

const argv = process.argv.slice(2);
let jsonPath = null;
let verbose = false;
let fail = true;
for (let index = 0; index < argv.length; index++) {
  const arg = argv[index];
  if (arg === '--json') jsonPath = argv[++index];
  else if (arg === '--verbose') verbose = true;
  else if (arg === '--no-fail') fail = false;
  else if (arg === '-h' || arg === '--help') {
    console.log('usage: node scripts/coverage.cjs [--verbose] [--json <path>] [--no-fail]');
    process.exit(0);
  } else {
    console.error('unknown argument: ' + arg);
    process.exit(2);
  }
}

const ts = loadTypescript();
function transpile(absolute) {
  const source = fs.readFileSync(absolute, 'utf8');
  if (/\.(cjs|js)$/.test(absolute)) return { source, compiled: source, map: null };
  const output = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2021,
      module: ts.ModuleKind.CommonJS,
      sourceMap: true,
      inlineSources: false,
    },
    fileName: path.basename(absolute),
  });
  return { source, compiled: output.outputText, map: output.sourceMapText };
}

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function decodeVlq(text) {
  const out = [];
  let shift = 0;
  let value = 0;
  for (const character of text) {
    const digit = BASE64.indexOf(character);
    if (digit < 0) return out;
    value += (digit & 31) << shift;
    if (digit & 32) { shift += 5; continue; }
    const negative = value & 1;
    value >>= 1;
    out.push(negative ? -value : value);
    value = 0;
    shift = 0;
  }
  return out;
}

/** 生成行(1-based) -> 源码行(1-based)，无映射返回 null。 */
function generatedToSourceLines(mapText) {
  const table = [];
  if (!mapText) return table;
  const mappings = JSON.parse(mapText).mappings || '';
  let sourceIndex = 0;
  let sourceLine = 0;
  let sourceColumn = 0;
  for (const group of mappings.split(';')) {
    let generatedColumn = 0;
    let first = null;
    for (const segment of group.split(',')) {
      if (!segment) continue;
      const fields = decodeVlq(segment);
      generatedColumn += fields[0] || 0;
      if (fields.length >= 4) {
        sourceIndex += fields[1];
        sourceLine += fields[2];
        sourceColumn += fields[3];
        if (first === null && sourceIndex === 0) first = sourceLine + 1;
      }
    }
    table.push(first);
  }
  return table;
}

// ---------------------------------------------------------------- collect coverage
const coverageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermeseye-coverage-'));
const suiteResults = [];
for (const suite of SUITES) {
  const run = spawnSync(process.execPath, [path.join(ROOT, 'scripts', suite)], {
    cwd: ROOT,
    env: { ...process.env, NODE_V8_COVERAGE: coverageDir },
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  const summary = (run.stdout || '').trim().split('\n').filter(Boolean).pop() || '';
  suiteResults.push({ suite, status: run.status, summary });
  if (run.status !== 0) {
    console.error(`用例 ${suite} 未通过（退出码 ${run.status}），覆盖率不可信：`);
    console.error((run.stdout || '') + (run.stderr || ''));
    process.exit(2);
  }
}

// 合并：绝对路径 -> 每个进程/脚本实例一份快照（Map: 函数体区间 -> {name, ranges}）。
// 为什么保留多份而不是按区间取 max：V8 块覆盖会**省略**与外层计数相同的嵌套区间，
// 也就是说"某个进程里没出现这个区间"可能意味着"该分支执行过"。按 max 合并会把
// 只在部分进程走到的分支误判为未覆盖，所以判定必须落在"每个进程"的粒度上。
const merged = new Map();
for (const entry of fs.readdirSync(coverageDir)) {
  if (!entry.endsWith('.json')) continue;
  const report = JSON.parse(fs.readFileSync(path.join(coverageDir, entry), 'utf8'));
  for (const script of report.result || []) {
    if (!script.url) continue;
    let absolute;
    try {
      absolute = script.url.startsWith('file://') ? fileURLToPath(script.url) : path.resolve(ROOT, script.url);
    } catch {
      continue;
    }
    if (SKIP_FILES.some(pattern => pattern.test(absolute))) continue;
    const isGate = absolute === path.join(GATE_DIR, 'check-standards.cjs');
    if (!isGate && (!absolute.startsWith(MAIN_DIR + path.sep) || !/\.(ts|ets)$/.test(absolute))) continue;
    if (isGate && !/\.(cjs|js)$/.test(absolute)) continue;
    const snapshot = new Map();
    for (const fn of script.functions || []) {
      const outer = (fn.ranges || [])[0];
      if (!outer) continue;
      const key = `${outer.startOffset}-${outer.endOffset}`;
      if (!snapshot.has(key)) snapshot.set(key, { name: fn.functionName || '', ranges: new Map() });
      const target = snapshot.get(key).ranges;
      for (const range of fn.ranges || []) {
        target.set(`${range.startOffset}-${range.endOffset}`, range.count);
      }
    }
    if (snapshot.size === 0) continue;
    if (!merged.has(absolute)) merged.set(absolute, []);
    merged.get(absolute).push(snapshot);
  }
}

// ---------------------------------------------------------------- measure
function rangesOf(snapshot) {
  const all = [];
  for (const fn of snapshot.values()) {
    for (const [key, count] of fn.ranges) {
      const [start, end] = key.split('-').map(Number);
      all.push({ start, end, count, span: end - start });
    }
  }
  return all;
}

function measure(absolute, snapshots) {
  const { source, compiled, map } = transpile(absolute);
  const sourceLines = source.split('\n');
  const toSourceLine = generatedToSourceLines(map);
  const starts = [0];
  for (let index = 0; index < compiled.length; index++) if (compiled[index] === '\n') starts.push(index + 1);
  const generatedLineOf = offset => {
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (starts[mid] <= offset) low = mid; else high = mid - 1;
    }
    return low + 1;
  };
  const sourceLineOf = offset => {
    const generated = generatedLineOf(offset);
    return toSourceLine[generated - 1] || generated;
  };

  // 每个进程各自求"最内层区间计数"，再逐偏移取最大值：进程内被省略的区间会继承
  // 外层计数，因此进程内的偏移覆盖是准确的，跨进程取 max 是安全的。
  const owner = new Int32Array(compiled.length).fill(-1);
  for (const snapshot of snapshots) {
    const local = new Int32Array(compiled.length).fill(-1);
    for (const range of rangesOf(snapshot).sort((left, right) => right.span - left.span)) {
      for (let index = range.start; index < range.end && index < local.length; index++) local[index] = range.count;
    }
    for (let index = 0; index < owner.length; index++) if (local[index] > owner[index]) owner[index] = local[index];
  }

  // 行覆盖：按源码行聚合生成行，任一段未执行即视为该行未覆盖
  const lineState = new Map(); // sourceLine -> min
  for (let generated = 1; generated <= starts.length; generated++) {
    const from = starts[generated - 1];
    const to = generated < starts.length ? starts[generated] : compiled.length;
    let min = Number.MAX_SAFE_INTEGER;
    let seen = false;
    for (let index = from; index < to && index < owner.length; index++) {
      if (owner[index] < 0) continue;
      seen = true;
      if (owner[index] < min) min = owner[index];
    }
    if (!seen) continue;
    const sourceLine = toSourceLine[generated - 1] || generated;
    const previous = lineState.get(sourceLine);
    lineState.set(sourceLine, previous === undefined ? min : Math.min(previous, min));
  }
  const uncoveredLines = [...lineState.entries()]
    .filter(([, min]) => min === 0)
    .map(([line]) => line)
    .sort((left, right) => left - right);
  const executableLines = lineState.size;
  const coveredLines = executableLines - uncoveredLines.length;

  // 函数与分支判定：
  // - 函数体区间在所有进程都为 0 => 未执行函数，其内部区间全部计入未覆盖；
  // - 否则，某区间只有当"每个执行过该函数的进程"里它都存在且计数为 0 时才算未覆盖；
  //   在某个执行过的进程里缺失 = V8 因与外层同计数而省略 = 该进程走到了这个分支。
  const universe = new Map(); // fnKey -> { name, outer: Map<process,C>, blocks: Map<rangeKey, Map<process,C>> }
  snapshots.forEach((snapshot, process) => {
    for (const [fnKey, fn] of snapshot) {
      if (!universe.has(fnKey)) universe.set(fnKey, { name: fn.name, outer: new Map(), blocks: new Map() });
      const entry = universe.get(fnKey);
      entry.outer.set(process, fn.ranges.get(fnKey) || 0);
      for (const [rangeKey, count] of fn.ranges) {
        if (rangeKey === fnKey) continue;
        if (!entry.blocks.has(rangeKey)) entry.blocks.set(rangeKey, new Map());
        entry.blocks.get(rangeKey).set(process, count);
      }
    }
  });

  const uncoveredFunctions = [];
  const uncoveredBranches = [];
  let blocks = 0;
  let coveredBlocks = 0;
  for (const [fnKey, entry] of universe) {
    const ran = [...entry.outer.entries()].filter(([, count]) => count > 0).map(([process]) => process);
    const [outerStart] = fnKey.split('-').map(Number);
    if (ran.length === 0) {
      const line = sourceLineOf(outerStart);
      uncoveredFunctions.push({ line, name: entry.name, text: (sourceLines[line - 1] || '').trim().slice(0, 120) });
      blocks += entry.blocks.size + 1;
      continue;
    }
    for (const [rangeKey, counts] of entry.blocks) {
      blocks++;
      const uncovered = ran.every(process => counts.get(process) === 0);
      if (!uncovered) { coveredBlocks++; continue; }
      const [start] = rangeKey.split('-').map(Number);
      const line = sourceLineOf(start);
      uncoveredBranches.push({ function: entry.name, line, text: (sourceLines[line - 1] || '').trim().slice(0, 120) });
    }
  }
  return {
    file: path.relative(ROOT, absolute),
    lines: executableLines,
    coveredLines,
    linePercent: executableLines === 0 ? 100 : Math.round((coveredLines / executableLines) * 1000) / 10,
    blocks,
    coveredBlocks,
    blockPercent: blocks === 0 ? 100 : Math.round((coveredBlocks / blocks) * 1000) / 10,
    uncoveredLines,
    uncoveredFunctions: uncoveredFunctions.sort((left, right) => left.line - right.line),
    uncoveredBranches: uncoveredBranches.sort((left, right) => left.line - right.line),
  };
}

const files = [];
for (const [absolute, snapshots] of [...merged.entries()].sort()) files.push(measure(absolute, snapshots));
const neverLoaded = [];
for (const directory of fs.readdirSync(MAIN_DIR, { withFileTypes: true })) {
  if (!directory.isDirectory()) continue;
  for (const name of fs.readdirSync(path.join(MAIN_DIR, directory.name))) {
    if (!/\.(ts|ets)$/.test(name)) continue;
    const absolute = path.join(MAIN_DIR, directory.name, name);
    if (SKIP_FILES.some(pattern => pattern.test(absolute))) continue;
    if (!merged.has(absolute)) neverLoaded.push(path.relative(ROOT, absolute));
  }
}

// ---------------------------------------------------------------- report
console.log('HermesEye 覆盖率（V8 精确块覆盖 + source map 行号映射）');
for (const result of suiteResults) console.log(`  ${result.suite}: ${result.summary}`);
console.log('');
console.log('  文件                                                   行                 块');
for (const result of files) {
  const lineCell = `${result.coveredLines}/${result.lines} ${result.linePercent}%`;
  const blockCell = `${result.coveredBlocks}/${result.blocks} ${result.blockPercent}%`;
  console.log(`  ${result.file.padEnd(52)} ${lineCell.padEnd(18)} ${blockCell}`);
}

const violations = [];
for (const floor of FLOORS) {
  const scoped = files.filter(result => floor.pattern.test(result.file));
  if (scoped.length === 0) continue;
  const totalLines = scoped.reduce((sum, result) => sum + result.lines, 0);
  const coveredLines = scoped.reduce((sum, result) => sum + result.coveredLines, 0);
  const totalBlocks = scoped.reduce((sum, result) => sum + result.blocks, 0);
  const coveredBlocks = scoped.reduce((sum, result) => sum + result.coveredBlocks, 0);
  const linePercent = totalLines === 0 ? 100 : Math.round((coveredLines / totalLines) * 1000) / 10;
  const blockPercent = totalBlocks === 0 ? 100 : Math.round((coveredBlocks / totalBlocks) * 1000) / 10;
  console.log('');
  console.log(`  ${floor.label}: 行 ${coveredLines}/${totalLines} ${linePercent}%（下限 ${floor.lines}%），` +
    `块 ${coveredBlocks}/${totalBlocks} ${blockPercent}%（下限 ${floor.blocks}%）`);
  if (linePercent < floor.lines) violations.push(`${floor.label} 行覆盖 ${linePercent}% < ${floor.lines}%`);
  if (blockPercent < floor.blocks) violations.push(`${floor.label} 块覆盖 ${blockPercent}% < ${floor.blocks}%`);
  for (const result of [...scoped].sort((left, right) => left.blockPercent - right.blockPercent || left.file.localeCompare(right.file))) {
    if (result.uncoveredFunctions.length === 0 && result.uncoveredBranches.length === 0) continue;
    console.log(`    ${result.file}：未执行函数 ${result.uncoveredFunctions.length} 个，未覆盖分支 ` +
      `${result.uncoveredBranches.length} 个，未覆盖行 ${result.uncoveredLines.length} 行`);
    for (const item of result.uncoveredFunctions) {
      console.log(`      未执行函数 L${item.line} ${item.name || '<匿名>'}: ${item.text}`);
    }
    const shown = verbose ? result.uncoveredBranches : result.uncoveredBranches.slice(0, MAX_REPORTED);
    for (const item of shown) console.log(`      未覆盖分支 L${item.line} ${item.function || '<匿名>'}: ${item.text}`);
    if (!verbose && result.uncoveredBranches.length > shown.length) {
      console.log(`      … 其余 ${result.uncoveredBranches.length - shown.length} 个用 --verbose 查看`);
    }
  }
}

if (neverLoaded.length > 0) {
  console.log('');
  console.log('  未被任何 Node 用例加载的生产文件（不计入下限；UI/Ability 由设备用例覆盖）：');
  for (const file of neverLoaded) console.log(`    ${file}`);
}

console.log('');
if (violations.length === 0) {
  console.log('覆盖率门禁: PASS（下限见 docs/design/15-coding-standard.md §8.1）');
} else {
  console.log(`覆盖率门禁: FAIL（${violations.length} 项不达标）`);
  for (const violation of violations) console.log(`  - ${violation}`);
}

if (jsonPath) {
  const report = {
    generatedAt: new Date().toISOString(),
    suites: suiteResults,
    floors: FLOORS.map(floor => ({ label: floor.label, lines: floor.lines, blocks: floor.blocks })),
    files,
    neverLoaded,
    violations,
  };
  fs.mkdirSync(path.dirname(path.resolve(ROOT, jsonPath)), { recursive: true });
  fs.writeFileSync(path.resolve(ROOT, jsonPath), JSON.stringify(report, null, 2) + '\n');
}

fs.rmSync(coverageDir, { recursive: true, force: true });
process.exit(violations.length === 0 || !fail ? 0 : 1);
