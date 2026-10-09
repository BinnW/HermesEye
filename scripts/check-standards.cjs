#!/usr/bin/env node
'use strict';
/*
 * HermesEye 规范门禁。
 *
 * 把 docs/15-coding-standard.md 与 docs/16-logging-standard.md 中可静态判定的条目
 * 变成一条命令，供 verify.sh 作为第一个阶段执行。DevEco 自带 CodeLinter 没有可用
 * 的无头 CLI（见 docs/testing/13-harmony-harness.md 已知限制 1），所以规则在这里实现。
 *
 * 用法：
 *   node scripts/check-standards.cjs                # 人读报告，有 error 时退出码 1
 *   node scripts/check-standards.cjs --quiet        # 只在失败时输出
 *   node scripts/check-standards.cjs --json out.json
 *   node scripts/check-standards.cjs --list-rules
 *
 * 规则 ID 与两份规范文档一一对应；新增规则必须同时改文档。
 */
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_ROOT = path.resolve(__dirname, '..');
let ROOT = DEFAULT_ROOT;
let MAIN_DIR = path.join(ROOT, 'entry/src/main/ets');
let LOCAL_TEST_DIR = path.join(ROOT, 'entry/src/test');
let DEVICE_TEST_DIR = path.join(ROOT, 'entry/src/ohosTest/ets');
let BACKEND_DIR = path.join(ROOT, 'backend');
let LOGGING_FILE = path.join(MAIN_DIR, 'services/Logging.ets');

/** 把扫描根切到 root（测试用 fixture 目录）；不传则回到仓库根。 */
function configureRoot(root) {
  ROOT = root || DEFAULT_ROOT;
  MAIN_DIR = path.join(ROOT, 'entry/src/main/ets');
  LOCAL_TEST_DIR = path.join(ROOT, 'entry/src/test');
  DEVICE_TEST_DIR = path.join(ROOT, 'entry/src/ohosTest/ets');
  BACKEND_DIR = path.join(ROOT, 'backend');
  LOGGING_FILE = path.join(MAIN_DIR, 'services/Logging.ets');
}

const RULES = [
  ['CS-01', 'error', 'core/ 只放可移植规则，不得 import 平台、上层或 core 以外模块'],
  ['CS-02', 'error', 'ArkUI 装饰器只允许出现在 pages/、components/ 与两个 ability 中'],
  ['CS-03', 'error', 'AssetStoreKit 只允许在 services/CredentialStore.ets 中 import'],
  ['CS-04', 'error', '禁止 any / unknown 等无类型占位'],
  ['CS-05', 'error', '禁止 Function 类型，写完整函数签名'],
  ['CS-06', 'error', '禁止 namespace / require / eval / 原型改写'],
  ['CS-07', 'warn', '单类型文件的主类型名必须与 PascalCase 文件名一致'],
  ['CS-08', 'error', '界面与组件禁止硬编码十六进制颜色，必须使用语义色资源'],
  ['CS-09', 'error', '禁止 Tab 缩进'],
  ['CS-10', 'warn', '字符串字面量使用单引号'],
  ['CS-11', 'warn', '文件末尾保留一个换行'],
  ['CS-12', 'warn', 'stateStyles 内使用 $r 是已知可疑模式，改动后必须设备验证'],
  ['CS-13', 'error', '新增 *.test.ets 必须注册进同目录 List.test.ets'],
  ['CS-14', 'error', '测试禁止 .only(); Hypium it() 必须带用例级别参数'],
  ['CS-15', 'error', '禁止提交疑似真实凭据字面量'],
  ['CS-16', 'warn', 'TODO 必须带日期（YYYY-MM-DD）'],
  ['CS-17', 'warn', '单行不超过 200 字符'],
  ['LOG-01', 'error', 'hilog 级别必须是 debug/info/warn/error/fatal'],
  ['LOG-02', 'error', 'hilog 第一个参数必须是 Logging.ets 的 LOG_DOMAIN'],
  ['LOG-03', 'error', 'hilog 第二个参数必须是已注册的 LogTag.<Name>'],
  ['LOG-04', 'error', 'hilog 文案必须是单个字符串字面量，禁止模板串或拼接'],
  ['LOG-05', 'error', '每个占位符必须显式 %{public}/%{private}，数量必须等于参数个数'],
  ['LOG-06', 'error', '可能含隐私的参数必须使用 %{private}'],
  ['LOG-07', 'error', '禁止 console.*，日志统一走 hilog'],
  ['LOG-08', 'error', '调用 hilog 的文件必须从 Logging.ets 引入 LOG_DOMAIN 与 LogTag'],
  ['LOG-09', 'error', '日志参数禁止 JSON.stringify/原始错误对象/堆栈，只允许错误码等脱敏值'],
  ['LOG-10', 'error', '禁止在 build() 内打印日志'],
  ['PY-01', 'error', 'Python 禁止裸 except:'],
  ['PY-02', 'error', 'Python 禁止宽泛 except 后静默 pass，必须记录或上抛'],
  ['PY-03', 'error', 'Python 业务路径禁止 print()，使用 logging'],
  ['PY-04', 'warn', '限定异常类型的静默 pass 需要注释说明为何可忽略'],
];
const RULE_MAP = new Map(RULES.map(rule => [rule[0], { severity: rule[1], title: rule[2] }]));

const DECORATORS = new Set(['Entry', 'Component', 'ComponentV2', 'State', 'Link', 'Prop', 'Provide', 'Consume',
  'Observed', 'ObjectLink', 'Watch', 'Builder', 'BuilderParam', 'Styles', 'Extend', 'AnimatableExtend',
  'Require', 'Track', 'Local', 'Param', 'Event', 'Once', 'Monitor', 'Computed', 'Type', 'Sendable',
  'Concurrent', 'Reusable', 'ReusableV2', 'Preview', 'CustomDialog', 'LocalBuilder', 'LocalStorageLink',
  'StorageLink', 'StorageProp', 'LocalStorageProp', 'Provider', 'Consumer', 'Trace']);
const SENSITIVE = /(^|[^A-Za-z0-9_])(token|secret|password|passwd|credential|authorization|apikey|api_key|alias|draft|prompt|content|body|title|address|url|uri|path|email|ref|session|message|payload|phone)([^A-Za-z0-9_]|$)/i;
const HILOG_CALLEE = /hilog\s*\.\s*(debug|info|warn|error|fatal)\s*\(/g;

const findings = [];
let parsedFiles = 0;
let jsonPath = null;
let quiet = false;

// ---------------------------------------------------------------- helpers
function add(rule, file, line, message, hint) {
  const meta = RULE_MAP.get(rule);
  if (!meta) throw new Error('unregistered rule ' + rule);
  findings.push({ rule, severity: meta.severity, file: path.relative(ROOT, file), line, message, hint: hint || '' });
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!/^(build|\.test|\.preview|node_modules|oh_modules|__pycache__|\.local|tests)$/.test(entry.name)) walk(full, out);
    } else {
      out.push(full);
    }
  }
  return out;
}

/** 把注释与字符串内容替换成空格，保留长度和换行，便于按偏移定位代码结构。 */
function mask(source) {
  const out = source.split('');
  let state = 'code';
  let index = 0;
  while (index < source.length) {
    const current = source[index];
    const next = source[index + 1];
    if (state === 'code') {
      if (current === '/' && next === '/') { out[index] = ' '; out[index + 1] = ' '; state = 'line'; index += 2; continue; }
      if (current === '/' && next === '*') { out[index] = ' '; out[index + 1] = ' '; state = 'block'; index += 2; continue; }
      if (current === '\'' || current === '"' || current === '`') {
        state = current === '\'' ? 'sq' : current === '"' ? 'dq' : 'tpl';
      }
      index++;
      continue;
    }
    if (state === 'line') {
      if (current === '\n') state = 'code'; else out[index] = ' ';
      index++;
      continue;
    }
    if (state === 'block') {
      if (current === '*' && next === '/') { out[index] = ' '; out[index + 1] = ' '; state = 'code'; index += 2; continue; }
      if (current !== '\n') out[index] = ' ';
      index++;
      continue;
    }
    if (state === 'sq' || state === 'dq') {
      const quote = state === 'sq' ? '\'' : '"';
      if (current === '\\') { out[index] = ' '; if (out[index + 1] !== '\n') out[index + 1] = ' '; index += 2; continue; }
      if (current === quote || current === '\n') state = 'code'; else out[index] = ' ';
      index++;
      continue;
    }
    // tpl: 保留换行，其余掩码；${} 内的表达式同样被掩码，属于可接受近似
    if (current === '\\') { out[index] = ' '; out[index + 1] = ' '; index += 2; continue; }
    if (current === '`') state = 'code'; else if (current !== '\n') out[index] = ' ';
    index++;
  }
  return out.join('');
}

function lineAt(source, offset) {
  let line = 1;
  for (let index = 0; index < offset && index < source.length; index++) if (source[index] === '\n') line++;
  return line;
}

function matchBrace(masked, openIndex) {
  let depth = 0;
  for (let index = openIndex; index < masked.length; index++) {
    const current = masked[index];
    if (current === '{') depth++;
    else if (current === '}') { depth--; if (depth === 0) return index; }
  }
  return -1;
}

/** 在掩码文本上定位调用，返回原始文本中的参数切片。 */
function findCalls(source, masked, callee) {
  const calls = [];
  callee.lastIndex = 0;
  let match;
  while ((match = callee.exec(masked)) !== null) {
    const open = masked.indexOf('(', match.index);
    if (open < 0) break;
    let depth = 0;
    let end = -1;
    for (let index = open; index < masked.length; index++) {
      const current = masked[index];
      if (current === '(') depth++;
      else if (current === ')') { depth--; if (depth === 0) { end = index; break; } }
    }
    if (end < 0) break;
    calls.push({ level: match[1], start: match.index, end, args: splitArguments(source, masked, open + 1, end) });
    callee.lastIndex = end + 1;
  }
  return calls;
}

function splitArguments(source, masked, start, end) {
  const args = [];
  let depth = 0;
  let from = start;
  for (let index = start; index < end; index++) {
    const current = masked[index];
    if (current === '(' || current === '[' || current === '{') depth++;
    else if (current === ')' || current === ']' || current === '}') depth--;
    else if (current === ',' && depth === 0) { args.push(source.slice(from, index).trim()); from = index + 1; }
  }
  const tail = source.slice(from, end).trim();
  if (tail.length > 0) args.push(tail);
  return args;
}

function readLoggingRegistry() {
  if (!fs.existsSync(LOGGING_FILE)) return null;
  const source = fs.readFileSync(LOGGING_FILE, 'utf8');
  const domain = /export\s+const\s+LOG_DOMAIN\s*:\s*number\s*=\s*(0x[0-9A-Fa-f]+|\d+)/.exec(source);
  const tags = new Map();
  const tagPattern = /static\s+readonly\s+(\w+)\s*:\s*string\s*=\s*'([^']+)'/g;
  let match;
  while ((match = tagPattern.exec(source)) !== null) tags.set(match[1], match[2]);
  return { domain: domain ? domain[1] : null, tags };
}

// ---------------------------------------------------------------- per-file checks
function checkLayering(file, area, source, masked) {
  const relative = path.relative(ROOT, file);
  const isCore = relative.startsWith('entry/src/main/ets/core/');
  const isUi = /entry\/src\/main\/ets\/(pages|components)\//.test(relative) ||
    /entry\/src\/main\/ets\/entry(ability|backupability)\//.test(relative);
  const imports = [];
  const importPattern = /import\s+[^;]*?from\s+'([^']+)'/g;
  let match;
  while ((match = importPattern.exec(source)) !== null) imports.push({ spec: match[1], line: lineAt(source, match.index) });

  if (isCore) {
    for (const entry of imports) {
      if (/^@(ohos|kit|huawei)/.test(entry.spec) || /^\.\.\//.test(entry.spec) || /\/(services|pages|components)\//.test(entry.spec)) {
        add('CS-01', file, entry.line, `core 不得依赖 '${entry.spec}'`, '把平台能力放到 services/，core/ 只保留可移植规则');
      }
    }
  }
  if (!isUi) {
    const decoratorPattern = /@([A-Z][A-Za-z0-9_]*)/g;
    while ((match = decoratorPattern.exec(masked)) !== null) {
      if (DECORATORS.has(match[1])) {
        add('CS-02', file, lineAt(masked, match.index), `非界面层出现 ArkUI 装饰器 @${match[1]}`, '装饰器只允许出现在 pages/、components/ 与 ability 中');
      }
    }
  }
  if (!/services\/CredentialStore\.ets$/.test(relative)) {
    for (const entry of imports) {
      if (entry.spec === '@kit.AssetStoreKit') {
        add('CS-03', file, entry.line, 'AssetStoreKit 只能在 CredentialStore.ets 中使用', '凭据读写必须集中在一个适配器里');
      }
    }
  }
}

function checkLanguage(file, source, masked) {
  let match;
  const anyPattern = /\b(any|unknown)\b/g;
  while ((match = anyPattern.exec(masked)) !== null) {
    add('CS-04', file, lineAt(masked, match.index), `出现无类型占位 '${match[1]}'`, '使用 interface/class 声明形状后断言');
  }
  const functionPattern = /(:\s*Function\b|\bFunction\s*\[\]|<Function>)/g;
  while ((match = functionPattern.exec(masked)) !== null) {
    add('CS-05', file, lineAt(masked, match.index), '使用了 Function 类型', '写完整签名，例如 (value: string) => void');
  }
  const forbiddenPattern = /(\bnamespace\s+[A-Za-z_$]|\b(require|eval)\s*\()/g;
  while ((match = forbiddenPattern.exec(masked)) !== null) {
    add('CS-06', file, lineAt(masked, match.index), `禁止使用 ${match[0].trim()}`, '模块只用 import/export');
  }
  const prototypePattern = /\b\w+\.prototype\s*[.\[]/g;
  while ((match = prototypePattern.exec(masked)) !== null) {
    add('CS-06', file, lineAt(masked, match.index), '禁止改写原型', '扩展能力用组合或独立函数');
  }
}

function checkNaming(file, source, masked) {
  const base = path.basename(file).replace(/\.(ets|ts)$/, '');
  // 只约束“一个文件一个组件/类”的情况；多类型规则模块（Domain.ts、WorkspaceComponents.ets）
  // 是既有约定，不因文件名不等于其中某个类型而报错。
  const names = [];
  const patterns = [/export\s+default\s+class\s+(\w+)/g,
    /@Component\s*(?:@\w+\s*)*struct\s+(\w+)/g, /struct\s+(\w+)/g];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(masked)) !== null) names.push(match[1]);
  }
  const unique = [...new Set(names)];
  if (unique.length !== 1 || unique[0] === base) return;
  add('CS-07', file, lineAt(masked, masked.indexOf(unique[0])), `文件声明的类型 '${unique[0]}' 与文件名 '${base}' 不一致`, '单类型文件用 PascalCase 且与类型同名；多类型模块文件可跳过');
}

function checkStyle(file, source, masked, area) {
  const lines = source.split('\n');
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (line.includes('\t')) add('CS-09', file, index + 1, '存在 Tab 缩进', '统一使用 2 个空格');
    if (line.length > 200) add('CS-17', file, index + 1, `单行 ${line.length} 字符`, '拆分表达式，保持单行不超过 200 字符');
    const todo = /TODO/.exec(line);
    if (todo && !/TODO\s*\([^)]*\d{4}-\d{2}-\d{2}/.test(line)) {
      add('CS-16', file, index + 1, 'TODO 缺少日期', '写成 TODO(YYYY-MM-DD, 负责人): 说明');
    }
  }
  if (source.length > 0 && !source.endsWith('\n')) add('CS-11', file, lines.length, '文件末尾缺少换行', '保留一个结尾换行');
  // 单引号：排除含单引号的字符串（换行/拼接类）以减少误报
  const doubleQuoted = /(^|[=(,:\s\[!&|?{}])\s*"([^"\n]*)"\s*(?=[),;:\]}.]|$)/gm;
  let match;
  while ((match = doubleQuoted.exec(source)) !== null) {
    const line = lineAt(source, match.index);
    if (/^\s*(\/\/|\*)/.test(lines[line - 1] || '')) continue;
    add('CS-10', file, line, '使用双引号字符串', "统一使用单引号");
  }
  const stateStylesPattern = /stateStyles\s*\(/g;
  while ((match = stateStylesPattern.exec(masked)) !== null) {
    const open = masked.indexOf('{', match.index);
    if (open < 0) continue;
    const close = matchBrace(masked, open);
    if (close < 0) continue;
    if (masked.slice(open, close).includes('$r(')) {
      add('CS-12', file, lineAt(masked, match.index), 'stateStyles 内使用了 $r', '历史上 $r 在该上下文失效导致 jscrash，改动后必须设备验证');
    }
  }
  if (area === 'main' && /entry\/src\/main\/ets\/(pages|components)\//.test(path.relative(ROOT, file))) {
    const hexPattern = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g;
    for (let index = 0; index < lines.length; index++) {
      if (/^\s*(\/\/|\*)/.test(lines[index])) continue;
      if (hexPattern.test(lines[index])) {
        add('CS-08', file, index + 1, '硬编码十六进制颜色', "改用 $r('app.color.xxx')，并在 base/dark 两份 color.json 中成对登记");
      }
    }
  }
}

function checkSecrets(file, source, area) {
  if (area === 'test' || area === 'ohosTest') return;
  const patterns = [
    [/sk-[A-Za-z0-9]{16,}/, '疑似 API Key 字面量'],
    [/Bearer\s+[A-Za-z0-9._~+/=-]{20,}/, '疑似 Bearer 凭据字面量'],
    [/(?:password|passwd|secret|token)\s*[:=]\s*'[A-Za-z0-9._~+/=-]{8,}'/i, '疑似口令/令牌字面量'],
  ];
  const lines = source.split('\n');
  for (let index = 0; index < lines.length; index++) {
    if (/^\s*(\/\/|\*|#)/.test(lines[index])) continue;
    for (const [pattern, label] of patterns) {
      if (pattern.test(lines[index])) {
        add('CS-15', file, index + 1, label, '凭据只进 Asset Store/环境变量，不写进源码');
      }
    }
  }
}

function checkLogging(file, source, masked, registry) {
  const calls = findCalls(source, masked, HILOG_CALLEE);
  if (calls.length > 0) {
    const importsLogging = /from\s+'[^']*Logging'/.test(source);
    if (!importsLogging) {
      add('LOG-08', file, lineAt(source, calls[0].start), '调用 hilog 但未从 Logging.ets 引入常量', "import { LOG_DOMAIN, LogTag } from './Logging'（按层级调整相对路径）");
    }
  }
  const buildPattern = /build\s*\(\s*\)\s*\{/g;
  const buildRanges = [];
  let buildMatch;
  while ((buildMatch = buildPattern.exec(masked)) !== null) {
    const open = masked.indexOf('{', buildMatch.index);
    const close = matchBrace(masked, open);
    if (close > 0) buildRanges.push([open, close]);
  }
  for (const call of calls) {
    const line = lineAt(source, call.start);
    if (call.args.length === 0) {
      add('LOG-01', file, line, 'hilog 调用没有参数', '按 hilog.<level>(LOG_DOMAIN, LogTag.X, 文案, 参数...) 调用');
      continue;
    }
    const format = call.args.length >= 3 ? call.args[2] : '';
    if (buildRanges.some(([open, close]) => call.start > open && call.start < close)) {
      add('LOG-10', file, line, '在 build() 内打印日志', 'build 每次渲染都会执行，日志移到事件处理函数中');
    }
    if (call.args[0] !== 'LOG_DOMAIN') {
      add('LOG-02', file, line, `hilog domain 写成了 ${call.args[0]}`, '只允许使用 Logging.ets 导出的 LOG_DOMAIN（禁止 0x0000/testTag 模板默认值）');
    }
    if (call.args.length >= 2) {
      const tagMatch = /^LogTag\.(\w+)$/.exec(call.args[1]);
      if (!tagMatch) {
        add('LOG-03', file, line, `hilog tag 写成了 ${call.args[1]}`, '使用已注册的 LogTag 常量，例如 LogTag.Workspace');
      } else if (registry && !registry.tags.has(tagMatch[1])) {
        add('LOG-03', file, line, `未注册的 tag LogTag.${tagMatch[1]}`, '先在 Logging.ets 登记，再同步 docs/16-logging-standard.md 的注册表');
      }
    }
    if (call.args.length >= 3) {
      if (!/^'[^']*'$/.test(format)) {
        add('LOG-04', file, line, `日志文案不是单个字符串字面量：${format}`, '禁止模板串与字符串拼接，日志正文只允许单引号字面量');
      } else {
        const text = format.slice(1, -1);
        if (text.trim().length === 0) add('LOG-04', file, line, '日志文案为空', '写明动作与对象，例如「工作区载入完成」');
        const placeholders = text.match(/%\{(?:public|private)\}[a-zA-Z]/g) || [];
        const bare = /%(?!%|\{public\}|\{private\})/.test(text);
        if (bare) add('LOG-05', file, line, '存在未标注可见性的占位符', '每个占位符显式写成 %{public}s / %{public}d / %{private}s');
        const extra = call.args.slice(3);
        if (placeholders.length !== extra.length) {
          add('LOG-05', file, line, `占位符 ${placeholders.length} 个但参数 ${extra.length} 个`, '二者必须一一对应，否则日志内容会错位');
        } else {
          for (let index = 0; index < placeholders.length; index++) {
            const arg = extra[index];
            if (/JSON\.stringify|\.stack\b|\.message\b|String\(\s*\w*err/i.test(arg)) {
              add('LOG-09', file, line, `日志参数疑似原始错误对象：${arg}`, '只打印错误码与稳定操作名，第三方 message 可能带路径或正文');
            }
            if (SENSITIVE.test(arg) && placeholders[index].includes('public')) {
              add('LOG-06', file, line, `隐私参数 ${arg} 使用了 %{public}`, '改成 %{private}，或只打印数量/状态/错误码');
            }
          }
        }
      }
    }
  }
  const consolePattern = /console\s*\.\s*(log|info|warn|error|debug|trace)\s*\(/g;
  let match;
  while ((match = consolePattern.exec(masked)) !== null) {
    add('LOG-07', file, lineAt(masked, match.index), `使用 console.${match[1]}`, '真机与日志归档只收 hilog，统一改用 Logging.ets 常量 + hilog');
  }
}

function checkTests(file, area) {
  if (!/\.test\.ets$/.test(file)) return;
  if (area === 'test') {
    const listFile = path.join(LOCAL_TEST_DIR, 'List.test.ets');
    checkRegistered(file, listFile);
  } else if (area === 'ohosTest') {
    const listFile = path.join(DEVICE_TEST_DIR, 'test/List.test.ets');
    checkRegistered(file, listFile);
  }
}

function checkRegistered(file, listFile) {
  const base = path.basename(file);
  if (base === 'List.test.ets') return;
  const name = base.replace(/\.ets$/, '');
  const listSource = fs.existsSync(listFile) ? fs.readFileSync(listFile, 'utf8') : '';
  if (!new RegExp(`from\\s+'\\./${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`).test(listSource)) {
    add('CS-13', file, 1, `未注册进 ${path.basename(listFile)}`, `在 ${path.basename(listFile)} 中 import ${name} from './${name}' 并调用`);
  }
}

function checkTestBody(file, source, masked) {
  const onlyPattern = /\.only\s*\(/g;
  let match;
  while ((match = onlyPattern.exec(masked)) !== null) {
    add('CS-14', file, lineAt(masked, match.index), '测试使用了 .only()', '提交前移除，避免整套用例被跳过');
  }
  const itPattern = /\bit\s*\(/g;
  while ((match = itPattern.exec(masked)) !== null) {
    const open = masked.indexOf('(', match.index);
    let depth = 0;
    let end = -1;
    for (let index = open; index < masked.length; index++) {
      if (masked[index] === '(') depth++;
      else if (masked[index] === ')') { depth--; if (depth === 0) { end = index; break; } }
    }
    if (end < 0) continue;
    const args = splitArguments(source, masked, open + 1, end);
    if (args.length < 3 || !/^\d+$/.test(args[1].trim())) {
      add('CS-14', file, lineAt(masked, match.index), 'Hypium it() 缺少用例级别参数', "写成 it('场景描述', 0, async () => { ... })");
    }
  }
}

function checkPython(file, source) {
  const lines = source.split('\n');
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (/^\s*except\s*:/.test(line)) add('PY-01', file, index + 1, '裸 except:', '捕获具体异常类型');
    if (/^\s*except\b[^:]*:\s*$/.test(line) && /^\s*(pass|\.\.\.)\s*$/.test(lines[index + 1] || '')) {
      const broad = /^\s*except\s+(Exception|BaseException)\s*(as\s+\w+)?\s*:/.test(line);
      if (broad) {
        add('PY-02', file, index + 1, '宽泛 except 后静默 pass', '至少记录 logger.warning/exception 或重新抛出');
      } else {
        add('PY-04', file, index + 1, 'except 后静默 pass（限定异常类型）', '确认确实无需处理，并补一行注释说明原因');
      }
    }
    if (/\bprint\s*\(/.test(line)) add('PY-03', file, index + 1, '业务代码使用 print()', '使用 logging.getLogger(__name__)，禁止输出用户数据');
  }
}

function checkBackendLogging(file, source) {
  const loggerPattern = /logger\s*\.\s*(debug|info|warning|error|exception)\s*\(/g;
  let match;
  while ((match = loggerPattern.exec(source)) !== null) {
    const start = source.indexOf('(', match.index);
    let depth = 0;
    let end = -1;
    const masked = mask(source);
    for (let index = start; index < masked.length; index++) {
      if (masked[index] === '(') depth++;
      else if (masked[index] === ')') { depth--; if (depth === 0) { end = index; break; } }
    }
    if (end < 0) continue;
    const args = splitArguments(source, masked, start + 1, end);
    const text = args[0] || '';
    if (!/^f?['"]/.test(text)) continue;
    if (/(token|secret|credential|authorization|password|body|payload)/i.test(text)) {
      add('LOG-06', file, lineAt(source, match.index), `疑似在日志文案中输出敏感字段：${text}`, '只记录操作名、状态与数量；凭据与正文永不入日志');
    }
  }
}

// ---------------------------------------------------------------- main
function parseArguments(argv) {
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--json') { jsonPath = argv[++index]; }
    else if (arg === '--quiet') { quiet = true; }
    else if (arg === '--list-rules') {
      for (const [id, severity, title] of RULES) console.log(`${id}  ${severity.padEnd(5)} ${title}`);
      return 'exit';
    } else if (arg === '-h' || arg === '--help') {
      console.log('usage: node scripts/check-standards.cjs [--quiet] [--json <path>] [--list-rules]');
      return 'exit';
    } else {
      console.error('unknown argument: ' + arg);
      return 'usage';
    }
  }
  return 'run';
}

function main() {
  const action = parseArguments(process.argv.slice(2));
  if (action === 'exit') return 0;
  if (action === 'usage') return 2;
  const result = scan(DEFAULT_ROOT);
  const report = result.report;

  if (!quiet || report.errors > 0) {
    console.log('HermesEye 规范门禁（docs/15 编码规范 + docs/16 日志规范）');
    console.log(`扫描 ${report.scannedFiles} 个文件；规则 ${RULES.length} 条`);
    for (const finding of report.findings) {
      console.log(`  ${finding.severity === 'error' ? 'ERROR' : 'WARN '} ${finding.rule} ${finding.file}:${finding.line} ${finding.message}`);
      if (finding.hint) console.log(`        提示: ${finding.hint}`);
    }
    console.log('');
    console.log(`规范门禁: ${report.errors === 0 ? 'PASS' : 'FAIL'}（${report.errors} error / ${report.warnings} warning）`);
  }

  if (jsonPath) {
    const target = path.resolve(ROOT, jsonPath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify(report, null, 2) + '\n');
  }
  return report.errors === 0 ? 0 : 1;
}

/**
 * 扫描一棵仓库树并返回机读报告。测试用 fixture 目录调用；CLI 用仓库根调用。
 * 返回 { report, findings }，report 已按严重级别与规则顺序排序。
 */
function scan(root) {
  configureRoot(root);
  findings.length = 0;
  parsedFiles = 0;

  const registry = readLoggingRegistry();
  if (!registry || !registry.domain) {
    findings.push({
      rule: 'LOG-02', severity: 'error', file: path.relative(ROOT, LOGGING_FILE), line: 1,
      message: 'Logging.ets 缺失或没有导出 LOG_DOMAIN', hint: '日志规范要求统一 domain 与 tag 注册表',
    });
  }

  const targets = [
    ...walk(MAIN_DIR).filter(file => /\.(ts|ets)$/.test(file)).map(file => [file, 'main']),
    ...walk(LOCAL_TEST_DIR).filter(file => /\.(ts|ets)$/.test(file)).map(file => [file, 'test']),
    ...walk(DEVICE_TEST_DIR).filter(file => /\.(ts|ets)$/.test(file)).map(file => [file, 'ohosTest']),
    ...walk(BACKEND_DIR).filter(file => /\.py$/.test(file)).map(file => [file, 'backend']),
  ];

  for (const [file, area] of targets) {
    const source = fs.readFileSync(file, 'utf8');
    parsedFiles++;
    if (area === 'backend') {
      checkPython(file, source);
      checkBackendLogging(file, source);
      continue;
    }
    const masked = mask(source);
    checkLayering(file, area, source, masked);
    checkLanguage(file, source, masked);
    checkStyle(file, source, masked, area);
    checkSecrets(file, source, area);
    checkLogging(file, source, masked, registry);
    if (area === 'main') checkNaming(file, source, masked);
    if (area === 'test' || area === 'ohosTest') { checkTests(file, area); checkTestBody(file, source, masked); }
  }

  const errors = findings.filter(finding => finding.severity === 'error');
  const warnings = findings.filter(finding => finding.severity === 'warn');
  const order = new Map(RULES.map((rule, index) => [rule[0], index]));
  findings.sort((left, right) =>
    (left.severity === right.severity ? 0 : left.severity === 'error' ? -1 : 1) ||
    order.get(left.rule) - order.get(right.rule) ||
    left.file.localeCompare(right.file) || left.line - right.line);

  const report = {
    generatedAt: new Date().toISOString(),
    root: ROOT,
    scannedFiles: parsedFiles,
    rules: RULES.map(([id, severity, title]) => ({ id, severity, title })),
    errors: errors.length,
    warnings: warnings.length,
    findings: findings.map(finding => ({ ...finding })),
  };
  return { report, findings: report.findings };
}

module.exports = { mask, splitArguments, lineAt, RULES, findings, main, scan, configureRoot };

if (require.main === module) process.exit(main());
