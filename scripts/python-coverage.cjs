#!/usr/bin/env node
'use strict';
/*
 * Python 后端行覆盖率门禁（纯标准库，无第三方依赖、不联网）。
 *
 * 仓库未安装 coverage 包，因此本脚本在 os.tmpdir() 写入一段临时 Python 驱动，
 * 用 sys.settrace/threading.settrace 记录 backend/*.py 每个可执行源码行的执行情况，
 * 再跑完整的 `python3 -m unittest discover -s backend/tests`，最后删除临时目录。
 *
 * 可执行行口径：用标准库 dis.findlinestarts 递归分析模块与嵌套代码对象，
 * 得到真正会生成字节码的行；空行、注释、多行字符串正文不计入分母，避免虚高。
 *
 * 用法：
 *   node scripts/python-coverage.cjs                 # 逐文件行覆盖 + 未覆盖行号，未达下限退出码 1
 *   node scripts/python-coverage.cjs --json out.json # 机读报告
 *   node scripts/python-coverage.cjs --no-fail       # 只报告不失败（排查用）
 *
 * 不可达行：backend/server.py 的 main()/进程入口需要真实端口、进程锁与信号，单元测试
 * 只覆盖 handler 与业务路径；这些行在 UNREACHABLE 中显式登记并从分母排除，输出中逐条说明。
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const BACKEND = path.join(ROOT, 'backend');
const PYTHON = process.env.PYTHON || 'python3';

// 每个必须达标的文件及其行覆盖下限。分母为“可执行行 - 已登记不可达行”。
const FLOORS = {
  'backend/reading.py': 90,
  'backend/store.py': 90,
  'backend/service.py': 90,
  'backend/server.py': 90,
  'backend/hermes.py': 90,
};

// 只真实网络/进程入口可达的行：显式登记，从分母排除，并在输出中说明原因。
const UNREACHABLE = {
  'backend/server.py': [
    { from: 114, to: 155, reason: 'main() 进程入口 + __main__ 守卫：需真实端口、fcntl 进程锁、信号与 HERMES_EYE_TOKEN，单元测试不启动监听进程' },
  ],
};

const argv = process.argv.slice(2);
let jsonPath = null;
let fail = true;
for (let index = 0; index < argv.length; index++) {
  const arg = argv[index];
  if (arg === '--json') jsonPath = argv[++index];
  else if (arg === '--no-fail') fail = false;
  else if (arg === '-h' || arg === '--help') {
    console.log('usage: node scripts/python-coverage.cjs [--json <path>] [--no-fail]');
    process.exit(0);
  } else {
    console.error('未知参数: ' + arg);
    process.exit(2);
  }
}

// ------------------------------------------------------------------ 临时驱动
const PY_DRIVER = `
import dis, io, json, os, sys, threading, types, unittest

ROOT = sys.argv[1]
OUT = sys.argv[2]
BACKEND = os.path.join(ROOT, 'backend')
TESTS = os.path.join(BACKEND, 'tests')

executed = {}

def target(path):
    if not path or not path.endswith('.py'):
        return None
    absolute = os.path.abspath(path)
    if os.path.dirname(absolute) != BACKEND:
        return None
    return absolute

def local(frame, event, arg):
    if event == 'line':
        path = target(frame.f_code.co_filename)
        if path is not None:
            lines = executed.get(path)
            if lines is None:
                lines = executed[path] = set()
            lines.add(frame.f_lineno)
    return local

def trace(frame, event, arg):
    if event == 'call' and target(frame.f_code.co_filename) is not None:
        return local
    return None

def executable(path):
    with open(path, 'rb') as handle:
        code = compile(handle.read(), path, 'exec')
    found = set()
    stack = [code]
    while stack:
        obj = stack.pop()
        for _offset, lineno in dis.findlinestarts(obj):
            if lineno:
                found.add(lineno)
        for const in obj.co_consts:
            if isinstance(const, types.CodeType):
                stack.append(const)
    return found

sys.path.insert(0, TESTS)
sys.path.insert(0, BACKEND)
sys.settrace(trace)
threading.settrace(trace)
stream = io.StringIO()
suite = unittest.TestLoader().discover(TESTS)
result = unittest.TextTestRunner(stream=stream, verbosity=2).run(suite)
sys.settrace(None)
threading.settrace(None)

files = []
for name in sorted(os.listdir(BACKEND)):
    if not name.endswith('.py'):
        continue
    absolute = os.path.join(BACKEND, name)
    lines = executable(absolute)
    run = executed.get(absolute, set())
    files.append(dict(file='backend/' + name, lines=sorted(lines), covered=sorted(lines & run)))

payload = dict(ok=result.wasSuccessful(), run=result.testsRun,
               failures=len(result.failures), errors=len(result.errors),
               output=stream.getvalue(), files=files)
with open(OUT, 'w', encoding='utf-8') as handle:
    json.dump(payload, handle, ensure_ascii=False)
`;

function compressed(lines) {
  const ranges = [];
  for (const line of lines) {
    const last = ranges[ranges.length - 1];
    if (last && line === last[1] + 1) last[1] = line;
    else ranges.push([line, line]);
  }
  return ranges.map(range => (range[0] === range[1] ? String(range[0]) : range[0] + '-' + range[1])).join(', ');
}

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'hermeseye-pycoverage-'));
const driverPath = path.join(temp, 'driver.py');
const outPath = path.join(temp, 'result.json');
let report = null;
let runStatus = null;
try {
  fs.writeFileSync(driverPath, PY_DRIVER);
  const run = spawnSync(PYTHON, [driverPath, ROOT, outPath], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  runStatus = run.status;
  if (run.error) {
    console.error('无法运行 ' + PYTHON + ': ' + run.error.message);
    process.exit(2);
  }
  if (fs.existsSync(outPath)) report = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  if (report) {
    const lines = report.output.trimEnd().split('\n');
    for (const line of lines) console.log('  ' + line);
  } else {
    console.error((run.stdout || '') + (run.stderr || ''));
    console.error('未生成覆盖率结果（退出码 ' + runStatus + '）');
    process.exit(2);
  }
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}

if (!report.ok) {
  console.error('后端用例未通过，覆盖率不可信（failures=' + report.failures + ' errors=' + report.errors + '）');
  process.exit(2);
}

// ------------------------------------------------------------------ 汇总
const results = [];
for (const entry of report.files) {
  const excluded = new Set();
  for (const note of UNREACHABLE[entry.file] || []) {
    for (let line = note.from; line <= note.to; line++) excluded.add(line);
  }
  const executable = new Set(entry.lines);
  const reachable = entry.lines.filter(line => !excluded.has(line));
  const coveredSet = new Set(entry.covered);
  const covered = reachable.filter(line => coveredSet.has(line));
  const uncovered = reachable.filter(line => !coveredSet.has(line));
  const excludedExecutable = entry.lines.filter(line => excluded.has(line));
  const percent = reachable.length === 0 ? 100 : Math.round((covered.length / reachable.length) * 1000) / 10;
  results.push({
    file: entry.file,
    covered: covered.length,
    total: reachable.length,
    percent,
    uncovered,
    executable: entry.lines.length,
    excluded: excludedExecutable,
    floor: FLOORS[entry.file] === undefined ? null : FLOORS[entry.file],
  });
}

console.log('');
console.log('HermesEye 后端行覆盖（sys.settrace + dis 可执行行口径，无第三方依赖）');
console.log('  用例: ' + report.run + ' 条通过，failures=' + report.failures + ' errors=' + report.errors);
for (const result of results) {
  console.log('backend 行覆盖：' + result.file + ' ' + result.covered + '/' + result.total + ' ' + result.percent + '%');
}

console.log('');
console.log('  明细（未覆盖行按区间压缩）:');
for (const result of results) {
  const note = result.floor === null ? '' : '（下限 ' + result.floor + '%）';
  const skipped = result.excluded.length === 0 ? '' : '，已排除不可达 ' + result.excluded.length + ' 行';
  console.log('  ' + result.file.padEnd(24) + result.covered + '/' + result.total + ' ' +
    String(result.percent).padStart(5) + '%' + note + skipped);
  if (result.uncovered.length > 0) console.log('    未覆盖行: ' + compressed(result.uncovered));
}

const annotated = Object.keys(UNREACHABLE).filter(file => results.some(result => result.file === file));
if (annotated.length > 0) {
  console.log('');
  console.log('  不可达/仅真实网络或进程路径（不计入分母）:');
  for (const file of annotated) {
    for (const note of UNREACHABLE[file]) {
      console.log('    ' + file + ' L' + note.from + '-' + note.to + '：' + note.reason);
    }
  }
}

const violations = [];
for (const result of results) {
  if (result.floor !== null && result.percent < result.floor) {
    violations.push(result.file + ' 行覆盖 ' + result.percent + '% < ' + result.floor + '%');
  }
}
console.log('');
if (violations.length === 0) {
  console.log('后端行覆盖门禁: PASS（reading/store/service/server/hermes 各 ≥90%，不可达行已登记）');
} else {
  console.log('后端行覆盖门禁: FAIL（' + violations.length + ' 项不达标）');
  for (const violation of violations) console.log('  - ' + violation);
}

if (jsonPath) {
  const output = {
    generatedAt: new Date().toISOString(),
    suite: { run: report.run, failures: report.failures, errors: report.errors, ok: report.ok },
    floors: FLOORS,
    unreachable: UNREACHABLE,
    files: results.map(result => ({
      file: result.file, covered: result.covered, total: result.total, percent: result.percent,
      executable: result.executable, excluded: result.excluded, uncovered: result.uncovered, floor: result.floor,
    })),
    violations,
  };
  const absolute = path.resolve(ROOT, jsonPath);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, JSON.stringify(output, null, 2) + '\n');
}

process.exit(violations.length === 0 || !fail ? 0 : 1);
