import { ReadingSnapshot, validateReadingSnapshot } from './Reading';
import { AppData, Message, Task, cleanText, apiBase, validateData } from './Domain';

export type OwnerKind = 'independent' | 'project' | 'plan' | 'book';
export type WorkStatus = 'todo' | 'doing' | 'done';
export interface Connection {
  name: string; host: string; protocol: string; port: number; basePath: string;
  model: string; allowPrivateHttp: boolean; autoConnect: boolean; credentialRef: string;
}
export interface ProjectMilestone { id: string; title: string; dueDate: string; done: boolean; }
export interface ProjectReview { id: string; text: string; createdAt: number; }
export interface Project {
  id: string; name: string; goal: string; managedBy: string; nextStep: string;
  kind?: string; status?: string; criteria?: string; targetDate?: string;
  milestones?: ProjectMilestone[]; reviews?: ProjectReview[];
}
export class ProjectDraft {
  name: string = '';
  goal: string = '';
  managedBy: string = 'manual';
  kind: string = 'learning';
  criteria: string = '';
  targetDate: string = '';
  nextStep: string = '';
  milestoneTitle: string = '';
  milestoneDate: string = '';
  review: string = '';
}
export interface Need {
  id: string; name: string; ownerKind: OwnerKind; ownerId: string; createdAt: number;
  messages: Message[];
}
export interface CalendarEntry { key: string; title: string; start: number; end: number; allDay: boolean; }
export interface PlanItem {
  id: string; date: string; title: string; status: WorkStatus; projectId: string; calendarSource?: CalendarEntry;
  priority?: string; minutes?: number; note?: string; suggestionKey?: string; suggestionReason?: string;
}
export interface PlanSuggestion { key: string; title: string; projectId: string; reason: string; }
export function shiftDay(date: string, amount: number): string {
  if (!validDate(date)) { throw new Error('请输入有效日期 YYYY-MM-DD'); }
  const value = new Date(date + 'T12:00:00');
  value.setDate(value.getDate() + amount);
  return dayKey(value);
}
export function savePlan(space: Space, id: string, date: string, title: string, projectId: string,
  priority: string, minutes: string, note: string): void {
  if (!validDate(date)) { throw new Error('请输入有效日期 YYYY-MM-DD'); }
  const content = cleanText(title, 200);
  if (projectId && !space.projects.some((item: Project) => item.id === projectId)) { throw new Error('项目已不存在'); }
  if (!['normal', 'important'].includes(priority)) { throw new Error('请选择有效优先级'); }
  const duration = minutes.trim() ? Number(minutes) : 0;
  if ((minutes.trim() && !/^\d+$/.test(minutes.trim())) || !Number.isInteger(duration) || duration < 0 || duration > 1440) {
    throw new Error('预计用时请输入 1–1440 分钟的整数，或留空');
  }
  if (minutes.trim() && duration === 0) { throw new Error('预计用时必须大于 0，或留空'); }
  if (note.length > 4000) { throw new Error('补充说明最多 4000 字'); }
  const existing = space.plans.find((item: PlanItem) => item.id === id);
  if (id && !existing) { throw new Error('计划已不存在，请返回列表'); }
  if (existing?.calendarSource && existing.date !== date) { throw new Error('日历事项不能改期，请在系统日历修改并重新读取'); }
  if (existing) {
    existing.date = date; existing.title = content; existing.projectId = projectId;
    existing.priority = priority; existing.minutes = duration; existing.note = note.trim();
  } else {
    space.plans.push({ id: newId(), date: date, title: content, status: 'todo', projectId: projectId,
      priority: priority, minutes: duration, note: note.trim() });
  }
}
export function removePlan(space: Space, id: string): void {
  if (!space.plans.some((item: PlanItem) => item.id === id)) { throw new Error('计划已不存在'); }
  // Preserve conversation history as an independent need when its source is removed.
  space.needs.forEach((need: Need) => {
    if (need.ownerKind === 'plan' && need.ownerId === id) { need.ownerKind = 'independent'; need.ownerId = ''; }
  });
  space.links = space.links.filter((link: NeedLink) => !(link.kind === 'plan' && link.ownerId === id));
  space.plans = space.plans.filter((item: PlanItem) => item.id !== id);
}
export function planSuggestions(space: Space, date: string): PlanSuggestion[] {
  if (!validDate(date)) { return []; }
  const from = shiftDay(date, -7);
  const result: PlanSuggestion[] = [];
  space.plans.filter((item: PlanItem) => !item.calendarSource && item.date >= from && item.date < date && item.status !== 'done')
    .sort((a: PlanItem, b: PlanItem) => b.date.localeCompare(a.date)).forEach((item: PlanItem) => {
      result.push({ key: 'plan/' + item.id, title: item.title, projectId: item.projectId,
        reason: `${item.date} · ${item.status === 'doing' ? '进行中' : '未完成'} · 来源计划 ${item.id}` });
    });
  space.records.filter((item: IntervalRecord) => {
    const day = dayKey(new Date(item.start === null ? item.createdAt : item.start));
    return day >= from && day < date && !!item.nextTodo.trim();
  }).sort((a: IntervalRecord, b: IntervalRecord) => b.createdAt - a.createdAt).forEach((item: IntervalRecord) => {
    result.push({ key: 'record/' + item.id, title: item.nextTodo.trim(), projectId: '',
      reason: `${dayKey(new Date(item.start === null ? item.createdAt : item.start))} · 记录中的新增待办${item.backfilled ? '（补记）' : ''} · 来源记录 ${item.id}` });
  });
  return result.filter((item: PlanSuggestion) => item.title.length <= 200 &&
    !space.plans.some((plan: PlanItem) => plan.date === date && plan.suggestionKey === item.key));
}
export function adoptPlanSuggestion(space: Space, date: string, key: string): void {
  const suggestion = planSuggestions(space, date).find((item: PlanSuggestion) => item.key === key);
  if (!suggestion) { throw new Error('建议已采纳或来源已变化，请重新查看'); }
  space.plans.push({ id: newId(), date: date, title: suggestion.title, projectId: suggestion.projectId,
    status: 'todo', suggestionKey: suggestion.key, suggestionReason: suggestion.reason });
}
export function calendarBusyMinutes(space: Space, date: string): number {
  if (!validDate(date)) { return 0; }
  const start = new Date(date + 'T00:00:00').getTime();
  const end = new Date(shiftDay(date, 1) + 'T00:00:00').getTime();
  const intervals = space.plans.filter((item: PlanItem) => item.date === date && item.calendarSource && !item.calendarSource.allDay)
    .map((item: PlanItem) => [Math.max(start, item.calendarSource!.start), Math.min(end, item.calendarSource!.end)])
    .filter((item: number[]) => item[1] > item[0]).sort((a: number[], b: number[]) => a[0] - b[0]);
  let total = 0; let lastEnd = start;
  intervals.forEach((item: number[]) => { total += Math.max(0, item[1] - Math.max(lastEnd, item[0])); lastEnd = Math.max(lastEnd, item[1]); });
  return Math.round(total / 60000);
}
export function importCalendarPlans(space: Space, entries: CalendarEntry[], keys: string[], date: string, projectId: string): number {
  if (!validDate(date)) { throw new Error('日历日期无效，请刷新'); }
  if (projectId && !space.projects.some((item: Project) => item.id === projectId)) { throw new Error('项目已不存在'); }
  let added = 0;
  for (const entry of entries) {
    if (!keys.includes(entry.key) || space.plans.some((item: PlanItem) => item.calendarSource?.key === entry.key)) { continue; }
    space.plans.push({ id: newId(), date: date, title: cleanText(entry.title, 200), status: 'todo', projectId: projectId,
      calendarSource: { key: entry.key, title: entry.title, start: entry.start, end: entry.end, allDay: entry.allDay } });
    added++;
  }
  return added;
}
export interface IntervalRecord {
  id: string; text: string; unfinished: string; energy: string; decision: string; nextTodo: string;
  start: number | null; end: number | null; createdAt: number; backfilled: boolean;
}
export interface ReadingItem {
  id: string; title: string; progress: string | null; notes: number | null; highlights: number | null;
  thoughts: number | null; weeklySummaries: number | null; source: string; updatedAt: number;
  excerpts: string[]; summaries: string[];
}
export interface RunEvent { id: string; at: number; agent: string; message: string; }
export interface AgentRun {
  id: string; needId: string; status: string; updatedAt: number; events: RunEvent[];
  artifacts: string[]; deployment: string;
}
export interface NeedLink { kind: OwnerKind; ownerId: string; needId: string; }
export interface Space {
  serverKey: string; links: NeedLink[]; projects: Project[]; needs: Need[]; plans: PlanItem[]; records: IntervalRecord[];
  readingSnapshot?: ReadingSnapshot; readingServerId?: string; readingWorkspaceId?: string;
  books: ReadingItem[]; runs: AgentRun[]; reminders: Task[]; lastSyncAt: number | null;
}
export interface Workspace {
  version: number; appearance: number; connection: Connection | null; activeServer: string; spaces: Space[];
}

export function newSpace(serverKey: string): Space {
  return { serverKey: serverKey, links: [], projects: [], needs: [], plans: [], records: [], books: [], runs: [], reminders: [], lastSyncAt: null };
}
export function newWorkspace(): Workspace {
  return { version: 2, appearance: 0, connection: null, activeServer: 'local', spaces: [newSpace('local')] };
}
export function newId(): string { return `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`; }
export function dayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function connectionUrl(value: Connection): string {
  cleanText(value.name, 100); cleanText(value.model, 100);
  const host = value.host.trim().toLowerCase();
  if (!host || !/^[a-z0-9.-]+$/.test(host) || host.includes('..') || host.startsWith('.') || host.endsWith('.')) {
    throw new Error('请输入 IP 或域名，不包含协议、端口、路径或凭据');
  }
  if (value.protocol !== 'https' && value.protocol !== 'http') { throw new Error('协议必须为 HTTPS 或 HTTP'); }
  if (!Number.isInteger(value.port) || value.port < 1 || value.port > 65535) { throw new Error('端口应为 1–65535 的整数'); }
  const path = value.basePath.trim();
  if (path && !path.startsWith('/')) { throw new Error('API 路径必须以 / 开始'); }
  return apiBase(`${value.protocol}://${host}:${value.port}${path}`, value.allowPrivateHttp);
}
export function serverKey(value: Connection): string { return connectionUrl(value); }
export function activeSpace(workspace: Workspace): Space {
  const space = workspace.spaces.find((item: Space) => item.serverKey === workspace.activeServer);
  if (!space) { throw new Error('服务器数据空间不存在'); }
  return space;
}
export function copyWorkspace(workspace: Workspace): Workspace { return JSON.parse(JSON.stringify(workspace)) as Workspace; }
export function selectConnection(workspace: Workspace, connection: Connection): void {
  const key = serverKey(connection);
  if (!workspace.spaces.some((item: Space) => item.serverKey === key)) { workspace.spaces.push(newSpace(key)); }
  workspace.connection = connection;
  workspace.activeServer = key;
}
export function ownerExists(space: Space, kind: OwnerKind, id: string): boolean {
  if (kind === 'independent') { return id === ''; }
  if (kind === 'project') { return space.projects.some((item: Project) => item.id === id); }
  if (kind === 'plan') { return space.plans.some((item: PlanItem) => item.id === id); }
  if (kind === 'book') { return space.books.some((item: ReadingItem) => item.id === id); }
  return false;
}
export function createNeed(space: Space, name: string, kind: OwnerKind, ownerId: string): Need {
  if (!ownerExists(space, kind, ownerId)) { throw new Error('请先建立有效的需求归属'); }
  const need: Need = { id: newId(), name: name.trim() ? cleanText(name, 100) : '漫无目的',
    ownerKind: kind, ownerId: ownerId, createdAt: Date.now(), messages: [] };
  space.needs.push(need);
  return need;
}
export function linkedNeed(space: Space, name: string, kind: OwnerKind, ownerId: string): Need {
  if (!ownerExists(space, kind, ownerId)) { throw new Error('需求来源不存在'); }
  const link = space.links.find((item: NeedLink) => item.kind === kind && item.ownerId === ownerId);
  if (link) {
    const need = space.needs.find((item: Need) => item.id === link.needId);
    if (!need) { throw new Error('关联会话不存在'); }
    return need;
  }
  const need = space.needs.find((item: Need) => item.ownerKind === kind && item.ownerId === ownerId) ||
    createNeed(space, name, kind, ownerId);
  space.links.push({ kind: kind, ownerId: ownerId, needId: need.id });
  return need;
}
export function moveNeed(space: Space, id: string, name: string, projectId: string): void {
  const need = space.needs.find((item: Need) => item.id === id);
  if (!need) { throw new Error('会话不存在'); }
  if (projectId && !ownerExists(space, 'project', projectId)) { throw new Error('目标项目不存在'); }
  need.name = cleanText(name, 100);
  need.ownerKind = projectId ? 'project' : 'independent'; need.ownerId = projectId;
}
export function planCounts(space: Space, date: string): number[] {
  const items = space.plans.filter((item: PlanItem) => item.date === date && !item.calendarSource);
  return [items.filter((item: PlanItem) => item.status === 'done').length,
    items.filter((item: PlanItem) => item.status === 'doing').length,
    items.filter((item: PlanItem) => item.status === 'todo').length];
}
export function validateRecord(record: IntervalRecord): void {
  cleanText(record.text);
  [record.unfinished, record.energy, record.decision, record.nextTodo].forEach((value: string) => {
    if (typeof value !== 'string' || value.length > 4000) { throw new Error('记录字段无效或过长'); }
  });
  if ((record.start === null) !== (record.end === null)) { throw new Error('区间起止时间需同时填写'); }
  if (record.start !== null && record.end !== null &&
    (!Number.isFinite(record.start) || !Number.isFinite(record.end) || record.start >= record.end || record.end > Date.now())) {
    throw new Error('记录区间必须有效，结束晚于开始且不在未来');
  }
  if (!Number.isFinite(record.createdAt) || typeof record.backfilled !== 'boolean') { throw new Error('记录时间无效'); }
}
export function dailyReport(space: Space, date: string): string {
  const records = space.records.filter((item: IntervalRecord) => dayKey(new Date(item.start === null ? item.createdAt : item.start)) === date);
  if (!records.length) { return '暂无当日记录，不能生成日报。'; }
  const parts: string[] = [`${date} · 本机记录汇总（非 AI 分析）`, '未配置经确认的周期策略，区间覆盖完整性未知。'];
  records.forEach((item: IntervalRecord) => {
    parts.push(`来源记录 ${item.id}${item.backfilled ? ' · 补记' : ''}\n${item.start === null ? '未标明事件区间' : new Date(item.start).toLocaleString() + ' — ' + new Date(item.end as number).toLocaleString()}\n完成 / 记录：${item.text}\n未完成：${item.unfinished || '未填写'}\n精力自述：${item.energy || '未填写'}\n决策：${item.decision || '未填写'}\n新增待办：${item.nextTodo || '未填写'}`);
  });
  parts.push('次日计划参考：逐项检查未完成事项与新增待办，由你确认加入。');
  return parts.join('\n\n');
}
export function migrateLegacy(legacy: AppData): Workspace {
  validateData(legacy);
  const workspace = newWorkspace();
  const space = activeSpace(workspace);
  space.records = legacy.notes.map((note) => ({ id: note.id, text: note.text, unfinished: '', energy: '', decision: '', nextTodo: '',
    start: null, end: null, createdAt: note.createdAt, backfilled: false }));
  space.reminders = legacy.tasks;
  if (legacy.messages.length) {
    const need = createNeed(space, '历史会话（V0.2 迁移）', 'independent', '');
    need.messages = legacy.messages;
  }
  if (legacy.settings.baseUrl.trim()) {
    const match = /^(https?):\/\/([a-zA-Z0-9.-]+)(?::(\d+))?(\/[^?#]*)?$/.exec(legacy.settings.baseUrl.trim());
    if (match) {
      const connection: Connection = { name: '历史 Hermes 连接', host: match[2], protocol: match[1],
        port: match[3] ? Number(match[3]) : match[1] === 'https' ? 443 : 80, basePath: match[4] || '',
        model: legacy.settings.model, allowPrivateHttp: legacy.settings.allowLocalHttp, autoConnect: false, credentialRef: '' };
      try {
        const key = serverKey(connection);
        workspace.connection = connection; workspace.spaces.push(newSpace(key));
      } catch { /* Invalid historical configuration stays in the untouched legacy file. */ }
    }
  }
  // Keep imported data local until the user explicitly chooses what to share with a server.
  return workspace;
}
function unique(ids: string[]): void {
  const seen: string[] = [];
  ids.forEach((id: string) => {
    if (typeof id !== 'string' || !id || seen.includes(id)) { throw new Error('重复或无效标识'); }
    seen.push(id);
  });
}
export function validateWorkspace(workspace: Workspace): Workspace {
  if (!workspace || workspace.version !== 2 || ![0, 1, 2].includes(workspace.appearance) || !Array.isArray(workspace.spaces)) {
    throw new Error('本地数据版本或格式异常');
  }
  if (workspace.connection !== null) {
    connectionUrl(workspace.connection);
    if (typeof workspace.connection.autoConnect !== 'boolean' || typeof workspace.connection.allowPrivateHttp !== 'boolean' ||
      typeof workspace.connection.credentialRef !== 'string') { throw new Error('连接配置损坏'); }
    if (workspace.activeServer !== 'local' && workspace.activeServer !== serverKey(workspace.connection)) { throw new Error('连接与数据空间不匹配'); }
  } else if (workspace.activeServer !== 'local') { throw new Error('远端空间缺少连接配置'); }
  unique(workspace.spaces.map((space: Space) => space.serverKey));
  workspace.spaces.forEach((space: Space) => {
    if (![space.links, space.projects, space.needs, space.plans, space.records, space.books, space.runs, space.reminders].every(Array.isArray)) {
      throw new Error('数据集合损坏');
    }
    unique(space.links.map((link: NeedLink) => link.kind + '/' + link.ownerId));
    space.links.forEach((link: NeedLink) => {
      if (!ownerExists(space, link.kind, link.ownerId) || !space.needs.some((need: Need) => need.id === link.needId)) {
        throw new Error('原始需求关联损坏');
      }
    });
    unique(space.projects.map((item: Project) => item.id));
    unique(space.needs.map((item: Need) => item.id));
    unique(space.plans.map((item: PlanItem) => item.id));
    unique(space.records.map((item: IntervalRecord) => item.id));
    unique(space.books.map((item: ReadingItem) => item.id));
    unique(space.runs.map((item: AgentRun) => item.id));
    if (space.lastSyncAt !== null && (!Number.isFinite(space.lastSyncAt) || space.lastSyncAt <= 0)) { throw new Error('同步时间无效'); }
    space.projects.forEach((item: Project) => {
      cleanText(item.name, 100); cleanText(item.goal);
      if (!['manual', 'agent'].includes(item.managedBy) || typeof item.nextStep !== 'string') { throw new Error('项目托管信息无效'); }
      validateProjectDetails(item);
    });
    space.plans.forEach((item: PlanItem) => {
      cleanText(item.title, 200);
      if ((item.priority !== undefined && !['normal', 'important'].includes(item.priority)) ||
        (item.minutes !== undefined && (!Number.isInteger(item.minutes) || item.minutes < 0 || item.minutes > 1440)) ||
        (item.note !== undefined && (typeof item.note !== 'string' || item.note.length > 4000)) ||
        (item.suggestionKey !== undefined && (typeof item.suggestionKey !== 'string' || item.suggestionKey.length > 200)) ||
        (item.suggestionReason !== undefined && (typeof item.suggestionReason !== 'string' || item.suggestionReason.length > 1000))) {
        throw new Error('计划详情格式无效');
      }
      if (item.calendarSource) {
        const source = item.calendarSource;
        if (!source.key || typeof source.title !== 'string' || !Number.isFinite(source.start) ||
          !Number.isFinite(source.end) || source.end < source.start || typeof source.allDay !== 'boolean') {
          throw new Error('日历来源无效');
        }
      }
      if (!validDate(item.date) || !['todo', 'doing', 'done'].includes(item.status) ||
        (item.projectId !== '' && !space.projects.some((project: Project) => project.id === item.projectId))) { throw new Error('计划格式无效'); }
    });
    space.needs.forEach((item: Need) => {
      cleanText(item.name, 100);
      if (!Number.isFinite(item.createdAt) || !ownerExists(space, item.ownerKind, item.ownerId) || !Array.isArray(item.messages)) { throw new Error('会话归属或历史无效'); }
      item.messages.forEach((message: Message) => {
        if (!['user', 'assistant'].includes(message.role) || typeof message.content !== 'string') { throw new Error('消息格式无效'); }
      });
    });
    space.records.forEach(validateRecord);
    if (space.readingSnapshot) { validateReadingSnapshot(space.readingSnapshot); }
    space.books.forEach((item: ReadingItem) => {
      cleanText(item.title, 300); cleanText(item.source, 300);
      if ((item.progress !== null && typeof item.progress !== 'string') || !Number.isFinite(item.updatedAt) || item.updatedAt <= 0 ||
        !Array.isArray(item.excerpts) || !Array.isArray(item.summaries) ||
        ![item.notes, item.highlights, item.thoughts, item.weeklySummaries].every((value: number | null) => value === null || (Number.isInteger(value) && value >= 0))) {
        throw new Error('阅读数据或统计口径无效');
      }
    });
    // Reuse reminder validation without imposing old record or conversation limits.
    validateData({ version: 1, notes: [], messages: [], tasks: space.reminders,
      settings: { baseUrl: '', model: 'hermes-agent', allowLocalHttp: false } });
    space.runs.forEach((run: AgentRun) => {
      if (!space.needs.some((need: Need) => need.id === run.needId) || !Array.isArray(run.events) || !Array.isArray(run.artifacts) ||
        !Number.isFinite(run.updatedAt) || typeof run.status !== 'string' || typeof run.deployment !== 'string') { throw new Error('运行关联无效'); }
    });
  });
  activeSpace(workspace);
  return workspace;
}
export function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) { return false; }
  const date = new Date(value + 'T12:00:00');
  return Number.isFinite(date.getTime()) && dayKey(date) === value;
}


// 项目扩展字段保持可选，旧工作区按「其他 / 进行中」显示，不重写历史目标。
export function validateProjectDetails(project: Project): void {
  if ((project.kind !== undefined && !['learning', 'fitness', 'effectiveness', 'software', 'other'].includes(project.kind)) ||
    (project.status !== undefined && !['active', 'paused', 'completed', 'archived'].includes(project.status))) {
    throw new Error('项目类型或状态无效');
  }
  if ((project.criteria !== undefined && (typeof project.criteria !== 'string' || project.criteria.length > 4000)) ||
    project.nextStep.length > 4000 ||
    (project.targetDate !== undefined && project.targetDate !== '' && !validDate(project.targetDate))) {
    throw new Error('项目完成标准、下一步或目标日期无效');
  }
  if (project.milestones !== undefined) {
    if (!Array.isArray(project.milestones) || project.milestones.length > 100) { throw new Error('项目里程碑格式无效或超过 100 项'); }
    unique(project.milestones.map((item: ProjectMilestone) => item.id));
    project.milestones.forEach((item: ProjectMilestone) => {
      cleanText(item.title, 200);
      if (typeof item.done !== 'boolean' || (item.dueDate !== '' && !validDate(item.dueDate))) { throw new Error('里程碑日期或状态无效'); }
    });
  }
  if (project.reviews !== undefined) {
    if (!Array.isArray(project.reviews)) { throw new Error('项目复盘格式无效'); }
    unique(project.reviews.map((item: ProjectReview) => item.id));
    project.reviews.forEach((item: ProjectReview) => {
      cleanText(item.text);
      if (!Number.isFinite(item.createdAt) || item.createdAt <= 0) { throw new Error('复盘时间无效'); }
    });
  }
}
export function projectKindLabel(kind: string = 'other'): string {
  if (kind === 'learning') { return '学习成长'; }
  if (kind === 'fitness') { return '健身运动'; }
  if (kind === 'effectiveness') { return '效能提升'; }
  if (kind === 'software') { return '软件构建'; }
  return '其他';
}
export function projectStatusLabel(status: string = 'active'): string {
  if (status === 'paused') { return '已暂停'; }
  if (status === 'completed') { return '已达成'; }
  if (status === 'archived') { return '已归档'; }
  return '进行中';
}
export function projectDraft(project?: Project): ProjectDraft {
  const draft = new ProjectDraft();
  if (project) {
    draft.name = project.name; draft.goal = project.goal; draft.managedBy = project.managedBy;
    draft.kind = project.kind || 'other'; draft.criteria = project.criteria || '';
    draft.targetDate = project.targetDate || ''; draft.nextStep = project.nextStep;
  }
  return draft;
}
export function saveProject(space: Space, id: string, draft: ProjectDraft): string {
  const existing = id ? space.projects.find((item: Project) => item.id === id) : undefined;
  if (id && !existing) { throw new Error('项目已不存在'); }
  if (existing?.status === 'archived') { throw new Error('请先恢复已归档项目'); }
  const project: Project = { id: id || newId(), name: cleanText(draft.name, 100), goal: cleanText(draft.goal),
    managedBy: draft.managedBy, nextStep: draft.nextStep.trim(), kind: draft.kind,
    status: existing?.status || 'active', criteria: cleanText(draft.criteria), targetDate: draft.targetDate.trim(),
    milestones: existing?.milestones || [], reviews: existing?.reviews || [] };
  if (!['manual', 'agent'].includes(project.managedBy)) { throw new Error('项目托管方式无效'); }
  validateProjectDetails(project);
  if (existing) { space.projects.splice(space.projects.indexOf(existing), 1, project); }
  else { space.projects.push(project); }
  return project.id;
}
export function changeProjectStatus(space: Space, id: string, status: string, evidence: string): void {
  const project = space.projects.find((item: Project) => item.id === id);
  if (!project) { throw new Error('项目已不存在'); }
  if (!['active', 'paused', 'completed', 'archived'].includes(status)) { throw new Error('项目状态无效'); }
  if (project.status === 'archived' && status !== 'active') { throw new Error('请先恢复已归档项目'); }
  const current = project.status || 'active';
  if (current === status) { return; }
  if ((status === 'paused' || status === 'completed') && current !== 'active') {
    throw new Error('请先重新推进项目，再选择暂停或达成');
  }
  if (status === 'completed') {
    const criteria = project.criteria || '';
    if (!criteria.trim()) { throw new Error('请先填写完成标准'); }
    cleanText(criteria);
    const review: ProjectReview = { id: newId(), text: '目标达成依据：' + cleanText(evidence, 3900), createdAt: Date.now() };
    project.reviews = (project.reviews || []).concat([review]);
  }
  project.status = status;
}
export function addProjectMilestone(space: Space, id: string, title: string, dueDate: string): void {
  const project = editableProject(space, id);
  const item: ProjectMilestone = { id: newId(), title: cleanText(title, 200), dueDate: dueDate.trim(), done: false };
  if (item.dueDate && !validDate(item.dueDate)) { throw new Error('里程碑日期请填写 YYYY-MM-DD'); }
  if ((project.milestones || []).length >= 100) { throw new Error('每个项目最多 100 项里程碑'); }
  project.milestones = (project.milestones || []).concat([item]);
}
function editableProject(space: Space, id: string): Project {
  const project = space.projects.find((item: Project) => item.id === id);
  if (!project) { throw new Error('项目已不存在'); }
  if (project.status === 'archived') { throw new Error('请先恢复已归档项目'); }
  return project;
}
export function setProjectMilestone(space: Space, id: string, milestoneId: string, done: boolean): void {
  const item = (editableProject(space, id).milestones || []).find((value: ProjectMilestone) => value.id === milestoneId);
  if (!item) { throw new Error('里程碑已不存在'); }
  item.done = done;
}
export function addProjectReview(space: Space, id: string, text: string): void {
  const project = editableProject(space, id);
  project.reviews = (project.reviews || []).concat([{ id: newId(), text: cleanText(text), createdAt: Date.now() }]);
}
export function projectBrief(project: Project): string {
  const milestones = (project.milestones || []).map((item: ProjectMilestone) =>
    (item.done ? '已完成：' : '待完成：') + item.title + (item.dueDate ? '（' + item.dueDate + '）' : '')).join('\n');
  const text = '请帮助我推进这个项目，先讨论建议，不代表授权执行或部署。\n项目：' + project.name +
    '\n类型：' + projectKindLabel(project.kind) + '\n状态：' + projectStatusLabel(project.status) +
    '\n目标：' + project.goal + '\n完成标准：' + (project.criteria || '待明确') +
    '\n目标日期：' + (project.targetDate || '未设定') + '\n下一步：' + (project.nextStep || '待讨论') +
    '\n最近复盘：\n' + (project.reviews || []).slice(-3).map((review: ProjectReview) => review.text).join('\n') +
    '\n里程碑：\n' + (milestones || '尚未制定') + '\n请先澄清约束，再给出可执行的下一步。';
  return text.length <= 3900 ? text : text.slice(0, 3800) + '\n（项目内容较长，此摘要已截短，请编辑并补充本次需要讨论的部分。）';
}
