'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function source(file) {
  return { path: path.resolve(file), sha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') };
}

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) return [];
    return entry.isDirectory() ? walk(file) : [file];
  });
}

function auditDocs(root) {
  const findings = [];
  const add = (severity, file, line, rule, detail) => findings.push({ severity, file, line, rule, detail });
  const required = ['AGENTS.md', 'README.md', 'docs/08-product-requirements-V1.0.md',
    'docs/09-frontend-design-V1.0.md', 'docs/03-architecture.md', 'docs/04-test-plan.md',
    'docs/05-release.md', 'docs/10-test_record.md', 'docs/13-harmony-harness.md'];
  for (const file of required) {
    if (!fs.existsSync(path.join(root, file))) add('error', file, 0, 'required-document', '缺少必需文档');
  }
  const docsDir = path.join(root, 'docs');
  const files = ['AGENTS.md', 'README.md', ...(fs.existsSync(docsDir) ? walk(docsDir)
    .filter((file) => file.endsWith('.md')).map((file) => path.relative(root, file)) : [])];
  const nav = fs.existsSync(path.join(root, 'AGENTS.md')) ? fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8') : '';
  for (const file of files) {
    const full = path.join(root, file);
    if (!fs.existsSync(full)) continue;
    let fence = null;
    let heading = 0;
    let h1 = 0;
    const lines = fs.readFileSync(full, 'utf8').split(/\r?\n/);
    lines.forEach((line, index) => {
      const marker = line.match(/^\s*(`{3,}|~{3,})/);
      if (marker) {
        if (!fence) fence = marker[1];
        else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = null;
        return;
      }
      if (fence) return;
      const title = line.match(/^(#{1,6})\s/);
      if (title) {
        const level = title[1].length;
        if (level === 1) h1++;
        if (level > heading + 1) add('warning', file, index + 1, 'heading-gap', `标题从 ${heading} 级跳到 ${level} 级`);
        heading = level;
      }
      // Deliberately limited to inline Markdown destinations, not a full Markdown parser.
      for (const link of line.matchAll(/\[[^\]]*\]\((<[^>]+>|[^\s)]+)(?:\s+"[^"]*")?\)/g)) {
        const target = link[1].replace(/^<|>$/g, '');
        if (/^(?:[a-z][\w+.-]*:|#|\/\/)/i.test(target)) continue;
        let local;
        try { local = decodeURIComponent(target.split(/[?#]/)[0]); } catch {
          add('error', file, index + 1, 'invalid-link', '链接编码无效'); continue;
        }
        if (local && !fs.existsSync(path.resolve(path.dirname(full), local))) {
          add('error', file, index + 1, 'broken-link', target);
        }
      }
    });
    if (h1 !== 1) add('warning', file, 1, 'document-title', `一级标题数量为 ${h1}，预期 1`);
    if (file.startsWith('docs/') && !file.startsWith('docs/validation/') && !nav.includes(`](${file})`)) {
      add('warning', file, 0, 'navigation', 'AGENTS.md 未直接链接此文档');
    }
  }
  return { status: findings.some((x) => x.severity === 'error') ? 'fail' : findings.length ? 'warning' : 'pass',
    checkedFiles: files.filter((file) => fs.existsSync(path.join(root, file))).length, findings,
    limitations: ['未验证锚点、引用式或 HTML 链接；标题检查不解析 Setext 标题', '结构通过不代表语义、时效或验收状态一致，需人工评审'] };
}

function analyzeLogs(file, pid) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  const counts = { D: 0, I: 0, W: 0, E: 0, F: 0 };
  const clues = [];
  const summaries = [];
  let recognized = 0;
  let considered = 0;
  let unknown = 0;
  let arktsErrors = 0;
  let arktsWarnings = 0;
  lines.forEach((line, index) => {
    if (!line.trim()) return;
    const hilog = line.match(/^\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d+\s+(\d+)\s+\d+\s+([DIWEF])\s+\S+:/);
    if (pid && (!hilog || hilog[1] !== pid)) return;
    considered++;
    if (hilog) { counts[hilog[2]]++; recognized++; }
    const error = /ArkTS:ERROR|ERROR:\s*ArkTS/.test(line);
    const warning = /ArkTS:WARN|WARN:\s*ArkTS/.test(line);
    if (error) arktsErrors++;
    if (warning) arktsWarnings++;
    const match = line.match(/Tests run:\s*(\d+),\s*Failure:\s*(\d+),\s*Error:\s*(\d+),\s*Pass:\s*(\d+),\s*Ignore:\s*(\d+)/);
    if (match) {
      const [run, failure, errors, pass, ignore] = match.slice(1).map(Number);
      summaries.push({ line: index + 1, run, failure, errors, pass, ignore,
        status: run > 0 && failure === 0 && errors === 0 && run === pass && ignore === 0 ? 'pass' : 'fail' });
    }
    const categories = [
      ['crash-suspect', /\b(?:crash|SIGSEGV|SIGABRT|FATAL)\b/i],
      ['stall-suspect', /\b(?:APP_FREEZE|ANR)\b/i],
      ['exception-suspect', /\b(?:TypeError|ReferenceError|uncaught)\b/i]
    ].filter(([, regex]) => regex.test(line)).map(([category]) => category);
    if (categories.length) clues.push({ line: index + 1, categories });
    if (!hilog && !error && !warning && !match) unknown++;
  });
  const hasEvidence = recognized + arktsErrors + arktsWarnings + summaries.length > 0;
  return { status: !hasEvidence ? 'blocked' : arktsErrors || summaries.some((x) => x.status === 'fail') ? 'fail' :
    counts.E || counts.F || arktsWarnings || clues.length || unknown ? 'warning' : 'pass',
  source: source(file), scope: pid ? { pid } : { pid: null, note: '混合来源，不能归因到 HermesEye' },
  consideredLines: considered, recognizedHilogLines: recognized, unclassifiedLines: unknown,
  levels: counts, arktsErrors, arktsWarnings, testSummaries: summaries, clues,
  limitations: ['只输出计数与行号，不复制原始消息；输入文件仍需妥善保护', 'pass 仅代表所识别内容没有命中规则，不是应用健康结论', '日志时间无年份，PID 可能复用；关键词只能作为排查线索'] };
}

function evaluatePerformance(data) {
  const invalid = (message) => { throw new Error(`性能输入无效：${message}`); };
  if (!data || data.schemaVersion !== 1) invalid('schemaVersion 必须为 1');
  for (const key of ['scenario', 'device', 'osVersion', 'build', 'collector', 'capturedAt']) {
    if (typeof data[key] !== 'string' || !data[key].trim()) invalid(`缺少 ${key}`);
  }
  if (Number.isNaN(Date.parse(data.capturedAt))) invalid('capturedAt 不是有效时间');
  if (!['emulator', 'device'].includes(data.targetKind)) invalid('targetKind 必须为 emulator 或 device');
  if (!Array.isArray(data.metrics) || !data.metrics.length) invalid('metrics 不能为空');
  const names = new Set();
  const metrics = data.metrics.map((metric) => {
    if (!metric || typeof metric.name !== 'string' || !metric.name.trim() || names.has(metric.name)) invalid('指标名缺失或重复');
    names.add(metric.name);
    if (!['ms', 'MiB', '%', 'mWh'].includes(metric.unit)) invalid(`${metric.name} 的单位不受支持`);
    if (!Array.isArray(metric.samples) || metric.samples.some((x) => typeof x !== 'number' || !Number.isFinite(x) || x < 0 || (metric.unit === '%' && x > 100))) invalid(`${metric.name} 样本必须是非负有限数，百分比需在 0–100`);
    const sorted = [...metric.samples].sort((a, b) => a - b);
    const quantile = (q) => sorted.length ? sorted[Math.ceil(sorted.length * q) - 1] : null;
    const stats = { count: sorted.length, p50: quantile(0.5), p95: quantile(0.95), max: sorted.length ? sorted[sorted.length - 1] : null };
    if (!metric.budget) return { name: metric.name, unit: metric.unit, ...stats, status: 'blocked', reason: '缺少明确预算' };
    const budget = metric.budget;
    if (!['p50', 'p95', 'max'].includes(budget.statistic) || typeof budget.max !== 'number' || !Number.isFinite(budget.max) || budget.max < 0 || !Number.isInteger(budget.minSamples) || budget.minSamples < 1) invalid(`${metric.name} 预算需要 statistic、非负 max 和正整数 minSamples`);
    const status = sorted.length < budget.minSamples ? 'blocked' : stats[budget.statistic] <= budget.max ? 'pass' : 'fail';
    return { name: metric.name, unit: metric.unit, ...stats, budget, status,
      reason: status === 'blocked' ? '样本不足' : '按项目提供的上限预算比较' };
  });
  return { status: metrics.some((x) => x.status === 'fail') ? 'fail' : metrics.some((x) => x.status === 'blocked') ? 'blocked' : 'pass',
    context: Object.fromEntries(['scenario', 'device', 'osVersion', 'build', 'collector', 'capturedAt', 'targetKind'].map((key) => [key, data[key]])),
    metrics, limitations: ['p50/p95 使用 nearest-rank，不代表统计置信度', '只评估输入指标；预算及采集真实性需人工确认；模拟器结果不能替代真机验收'] };
}
module.exports = { auditDocs, analyzeLogs, evaluatePerformance, source };
