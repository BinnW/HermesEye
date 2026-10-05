import { common, ConfigurationConstant } from '@kit.AbilityKit';
import { Message, Settings, Task, Snapshot, cleanText, contextText, createRequest } from '../core/Domain';
import { Workspace, Space, Need, Project, PlanItem, ReadingItem, IntervalRecord, OwnerKind, WorkStatus,
  Connection, AgentRun, RunEvent, newWorkspace, activeSpace, copyWorkspace, createNeed, linkedNeed, moveNeed, newId,
  CalendarEntry, importCalendarPlans, dayKey, validDate, connectionUrl, serverKey, dailyReport, planCounts, PlanSuggestion, savePlan, removePlan, shiftDay, planSuggestions, adoptPlanSuggestion, calendarBusyMinutes } from '../core/Workspace';
import { WorkspaceRepository } from '../services/WorkspaceRepository';
import { CredentialStore } from '../services/CredentialStore';
import { ConnectionService } from '../services/ConnectionService';
import { KeyboardAvoidance } from '../services/KeyboardAvoidance';
import { HermesClient } from '../services/HermesClient';
import { readCalendarEntries, calendarText, deviceSnapshot, publishReminder, cancelReminder } from '../services/NativeData';
import { IntegrationCapability, integrationCapabilities } from '../services/IntegrationCapabilities';
import { SectionHeading, WorkspaceAction } from '../components/WorkspaceComponents';
import { DailyPlanCard } from '../components/DailyPlanCard';
import { WorkspaceNavigationItem } from '../components/WorkspaceNavigation';

@Entry
@Component
struct Index {
  @State data: Workspace = newWorkspace();
  @State ready: boolean = false;
  @State loaded: boolean = false;
  @State busy: boolean = false;
  @State sending: boolean = false;
  @State tab: number = 0;
  @State route: string = '';
  @State availableWidth: number = 0;
  @State keyboardVisible: boolean = false;
  @State pendingPrompt: string = '';
  @State pendingKey: string = '';
  @State sendError: string = '';
  @State calendarEntries: CalendarEntry[] = [];
  @State calendarSelection: string[] = [];
  @State calendarDate: string = '';
  private pendingScrolled: boolean = false;
  private lastToast: string = '';
  private lastToastAt: number = 0;
  @State connectionStatus: string = '尚未连接';
  @State name: string = '';
  @State host: string = '';
  @State protocol: string = 'https';
  @State port: string = '443';
  @State basePath: string = '';
  @State model: string = 'hermes-agent';
  @State token: string = '';
  @State showToken: boolean = false;
  @State allowHttp: boolean = false;
  @State autoConnect: boolean = false;
  @State projectName: string = '';
  @State projectGoal: string = '';
  @State managedBy: string = 'manual';
  @State needName: string = '';
  @State needDescription: string = '';
  @State needProject: string = '';
  @State chatDraft: string = '';
  @State rename: string = '';
  @State moveProject: string = '';
  @State planTitle: string = '';
  @State planDate: string = dayKey(new Date());
  @State planProject: string = '';
  @State planEditId: string = '';
  @State planEditDate: string = dayKey(new Date());
  @State planPriority: string = 'normal';
  @State planMinutes: string = '';
  @State planNote: string = '';
  @State planFilter: string = 'all';
  @State confirmPlanDelete: boolean = false;
  @State calendarError: string = '';
  @State recordText: string = '';
  @State recordUnfinished: string = '';
  @State recordEnergy: string = '';
  @State recordDecision: string = '';
  @State recordTodo: string = '';
  @State recordStart: string = '';
  @State recordEnd: string = '';
  @State backfilled: boolean = false;
  @State reportDate: string = dayKey(new Date());
  @State reminderTitle: string = '';
  @State reminderTime: string = '21:00';
  @State weekdays: boolean = false;
  @State shareCalendar: boolean = false;
  @State shareDevice: boolean = false;
  @State shareNeed: string = '';
  @State snapshot: Snapshot = { calendar: '', device: '', capturedAt: 0 };
  private repository: WorkspaceRepository = new WorkspaceRepository();
  private credentials: CredentialStore = new CredentialStore();
  private client: HermesClient = new HermesClient();
  private keyboardAvoidance: KeyboardAvoidance = new KeyboardAvoidance();
  private scroller: Scroller = new Scroller();
  private history: string[] = [];
  private offsets: Map<string, number> = new Map();
  private drafts: Map<string, string> = new Map();
  private formDrafts: Map<string, string[]> = new Map();
  private projectDrafts: Map<string, string> = new Map();
  private labels: string[] = ['今日', '项目', '阅读', '我的'];
  private icons: Resource[] = [$r('app.media.nav_today'), $r('app.media.nav_projects'), $r('app.media.nav_reading'), $r('app.media.nav_profile')];
  private capabilities: IntegrationCapability[] = integrationCapabilities();

  aboutToAppear(): void {
    this.load();
    this.keyboardAvoidance.start(this.context(), (visible: boolean) => { this.keyboardVisible = visible; })
      .catch(() => { this.notice('键盘适配初始化失败，请重新打开页面', true); });
  }
  aboutToDisappear(): void {
    try { this.keyboardAvoidance.stop(); } catch { /* Window may already be destroyed. */ }
  }
  private context(): common.UIAbilityContext { return this.getUIContext().getHostContext() as common.UIAbilityContext; }
  private space(): Space { return activeSpace(this.data); }
  private routeKey(): string { return `${this.data.activeServer}|${this.route.startsWith('chat/') ? 'need' : this.tab}|${this.route}`; }
  private notice(message: string, failed: boolean = false): void {
    if (message === this.lastToast && Date.now() - this.lastToastAt < 1500) { return; }
    this.lastToast = message; this.lastToastAt = Date.now();
    this.getUIContext().getPromptAction().showToast({ message: message, duration: failed ? 5000 : 3000 });
  }
  private remember(): void {
    this.offsets.set(this.routeKey(), this.scroller.currentOffset().yOffset);
    if (this.route.startsWith('chat/')) { this.drafts.set(this.routeKey(), this.chatDraft); }
  }
  private restore(): void {
    this.chatDraft = this.drafts.get(this.routeKey()) || '';
    this.shareCalendar = false; this.shareDevice = false; this.shareNeed = '';
    const offset = this.offsets.get(this.routeKey()) || 0;
    setTimeout(() => { this.scroller.scrollTo({ xOffset: 0, yOffset: offset }); }, 0);
  }
  private go(route: string): void { this.remember(); this.history.push(this.route); this.route = route;
    if (route.startsWith('project/')) { this.projectNextStep = this.projectDrafts.get(this.data.activeServer + '/' + route) ?? this.selectedProject()?.nextStep ?? ''; }
    this.restore(); }
  private back(): void { this.remember(); this.route = this.history.pop() || ''; this.restore(); }
  private switchTab(index: number): void { this.remember(); this.tab = index; this.route = ''; this.history = []; this.restore(); }
  onBackPress(): boolean { if (this.route) { this.back(); return true; } return false; }
  private applyAppearance(index: number): void {
    const modes: ConfigurationConstant.ColorMode[] = [ConfigurationConstant.ColorMode.COLOR_MODE_NOT_SET,
      ConfigurationConstant.ColorMode.COLOR_MODE_LIGHT, ConfigurationConstant.ColorMode.COLOR_MODE_DARK];
    this.context().getApplicationContext().setColorMode(modes[index]);
  }
  private fillConnection(): void {
    const config = this.data.connection;
    if (!config) { return; }
    this.name = config.name; this.host = config.host; this.protocol = config.protocol;
    this.port = String(config.port); this.basePath = config.basePath; this.model = config.model;
    this.allowHttp = config.allowPrivateHttp; this.autoConnect = config.autoConnect;
  }
  private async load(): Promise<void> {
    try {
      this.data = await this.repository.load(this.context()); this.ready = true; this.loaded = true;
      this.fillConnection();
      try { this.applyAppearance(this.data.appearance); } catch { this.notice('数据已加载，显示模式切换失败，重启后重试', true); }
      const config = this.data.connection;
      if (config && config.credentialRef) {
        try { this.token = await this.credentials.read(config.credentialRef); }
        catch { this.notice('本地数据已加载；安全凭据暂不可用，请解锁或重新填写 Token', true); }
      }
      if (config && config.autoConnect && this.data.activeServer === serverKey(config) && this.token) {
        try { await this.connectSaved(); } catch (error) { this.notice((error as Error).message, true); }
      }
    } catch { this.notice('本地数据读取失败，禁止写入以保护原文件。请重新打开应用。', true); }
  }
  private rememberForms(): void {
    this.formDrafts.set(this.data.activeServer, [this.projectName, this.projectGoal, this.managedBy, this.needName, this.needDescription, this.needProject, this.rename, this.moveProject, this.planTitle, this.planDate, this.planProject, this.recordText, this.recordUnfinished, this.recordEnergy, this.recordDecision, this.recordTodo, this.recordStart, this.recordEnd, this.reportDate, this.reminderTitle, this.reminderTime, this.projectNextStep, String(this.backfilled), String(this.weekdays), this.planEditId, this.planEditDate, this.planPriority, this.planMinutes, this.planNote]);
  }
  private restoreForms(): void {
    const fields = this.formDrafts.get(this.data.activeServer) || ['', '', 'manual', '', '', '', '', '', '', dayKey(new Date()), '', '', '', '', '', '', '', '', dayKey(new Date()), '', '21:00', '', 'false', 'false'];
    this.projectName = fields[0];
    this.projectGoal = fields[1];
    this.managedBy = fields[2];
    this.needName = fields[3];
    this.needDescription = fields[4];
    this.needProject = fields[5];
    this.rename = fields[6];
    this.moveProject = fields[7];
    this.planTitle = fields[8];
    this.planDate = fields[9];
    this.planProject = fields[10];
    this.recordText = fields[11];
    this.recordUnfinished = fields[12];
    this.recordEnergy = fields[13];
    this.recordDecision = fields[14];
    this.recordTodo = fields[15];
    this.recordStart = fields[16];
    this.recordEnd = fields[17];
    this.reportDate = fields[18];
    this.reminderTitle = fields[19];
    this.reminderTime = fields[20];
    this.projectNextStep = fields[21];
    this.backfilled = fields[22] === 'true'; this.weekdays = fields[23] === 'true';
    this.planEditId = fields[24] || ''; this.planEditDate = fields[25] || dayKey(new Date());
    this.planPriority = fields[26] || 'normal'; this.planMinutes = fields[27] || ''; this.planNote = fields[28] || '';
    this.confirmPlanDelete = false; this.planFilter = 'all';
  }
  private async commit(change: (next: Workspace, space: Space) => void, success: string = '已保存到本机，尚未同步'): Promise<boolean> {
    if (!this.ready || this.busy) { return false; }
    this.busy = true;
    try {
      const next = copyWorkspace(this.data); change(next, activeSpace(next));
      await this.repository.save(next);
      const changedServer = next.activeServer !== this.data.activeServer;
      if (changedServer) { this.remember(); this.rememberForms(); }
      this.data = next;
      if (changedServer) { this.restoreForms(); this.restore(); }
      if (success) { this.notice(success); } return true;
    } catch (error) { this.notice((error as Error).message || '保存失败，请重试', true); return false; }
    finally { this.busy = false; }
  }
  private config(): Connection {
    if (!/^\d+$/.test(this.port)) { throw new Error('端口应为整数'); }
    const config: Connection = { name: this.name, host: this.host, protocol: this.protocol, port: Number(this.port), basePath: this.basePath,
      model: this.model, allowPrivateHttp: this.allowHttp, autoConnect: this.autoConnect, credentialRef: '' };
    connectionUrl(config); return config;
  }
  private settings(config: Connection): Settings {
    return { baseUrl: connectionUrl(config), model: config.model, allowLocalHttp: config.allowPrivateHttp };
  }
  private async testConnection(): Promise<void> {
    if (this.busy) { return; }
    this.busy = true;
    try { await this.client.check(this.settings(this.config()), this.token); this.notice('当前输入测试通过；未保存，也未同步业务数据'); }
    catch (error) { this.notice((error as Error).message, true); }
    finally { this.busy = false; }
  }
  private async saveConnection(connect: boolean): Promise<void> {
    if (this.busy || !this.ready) { return; }
    this.busy = true;
    try {
      const input = this.config();
      const service = new ConnectionService(this.repository, this.credentials);
      this.remember(); this.rememberForms();
      this.data = await service.save(this.data, input, this.token);
      this.connectionStatus = '配置已保存 · 尚未连接';
      this.snapshot = { calendar: '', device: '', capturedAt: 0 }; this.restoreForms(); this.restore();
      this.notice('配置与安全凭据已保存；已切换到该服务器独立数据空间，其他空间数据保留');
      if (connect) { await this.connectSaved(); }
    } catch (error) { this.notice((error as Error).message, true); }
    finally { this.busy = false; }
  }
  private async connectSaved(): Promise<void> {
    const config = this.data.connection;
    if (!config) { throw new Error('请先保存连接'); }
    this.connectionStatus = '连接中';
    try {
      const token = await this.credentials.read(config.credentialRef);
      await this.client.check(this.settings(config), token);
      this.connectionStatus = '文本接口已连接 · 业务同步待接入';
      this.notice('认证检测通过。会话持久化、同步与运行事件协议尚待联调，未标记为已同步');
    } catch (error) { this.connectionStatus = '连接失败 · 本机数据可浏览'; throw error as Error; }
  }
  private async addProject(): Promise<void> {
    let id = '';
    if (await this.commit((_next: Workspace, space: Space) => {
      id = newId(); space.projects.push({ id: id, name: cleanText(this.projectName, 100), goal: cleanText(this.projectGoal), managedBy: this.managedBy, nextStep: '' });
    })) { this.projectName = ''; this.projectGoal = ''; this.go('project/' + id); }
  }
  private async openLinked(name: string, kind: OwnerKind, id: string): Promise<void> {
    const source = this.space().links.find((link) => link.kind === kind && link.ownerId === id);
    const linked = source ? this.space().needs.find((need: Need) => need.id === source.needId) : undefined;
    if (linked) { this.go('chat/' + linked.id); return; }
    const existing = this.space().needs.find((need: Need) => need.ownerKind === kind && need.ownerId === id);
    if (existing) { this.go('chat/' + existing.id); return; }
    let needId = '';
    if (await this.commit((_next: Workspace, space: Space) => { needId = linkedNeed(space, name, kind, id).id; })) { this.go('chat/' + needId); }
  }
  private async addNeed(): Promise<void> {
    let id = '';
    if (await this.commit((_next: Workspace, space: Space) => {
      id = createNeed(space, this.needName, this.needProject ? 'project' : 'independent', this.needProject).id;
    })) {
      const description = this.needDescription;
      this.needName = ''; this.needDescription = ''; this.needProject = '';
      this.go('chat/' + id); this.chatDraft = description; this.drafts.set(this.routeKey(), description);
    }
  }
  private async addPlan(): Promise<void> {
    if (await this.commit((_next: Workspace, space: Space) => {
      savePlan(space, this.planEditId, this.planEditDate, this.planTitle, this.planProject,
        this.planPriority, this.planMinutes, this.planNote);
    })) {
      this.planDate = this.planEditDate; this.planTitle = ''; this.planEditId = ''; this.planNote = ''; this.planMinutes = '';
      this.confirmPlanDelete = false; this.planPriority = 'normal'; this.planProject = '';
      if (this.route === 'plan-editor') { this.back(); }
    }
  }
  private editPlan(id: string): void {
    const item = this.space().plans.find((plan: PlanItem) => plan.id === id);
    if (!item) { this.notice('事项已不存在', true); return; }
    if (this.planEditId === id) { this.confirmPlanDelete = false; this.go('plan-editor'); return; }
    this.planEditId = id; this.planTitle = item.title; this.planEditDate = item.date; this.planProject = item.projectId;
    this.planPriority = item.priority || 'normal'; this.planMinutes = item.minutes ? String(item.minutes) : ''; this.planNote = item.note || '';
    this.confirmPlanDelete = false; this.go('plan-editor');
  }
  private newPlan(): void {
    // Returning to a new-item draft keeps its input; explicitly editing another item replaces it.
    if (this.planEditId) { this.planTitle = ''; this.planNote = ''; this.planMinutes = ''; this.planPriority = 'normal'; this.planProject = ''; }
    this.planEditId = ''; this.planEditDate = this.planDate; this.confirmPlanDelete = false; this.go('plan-editor');
  }
  private changePlanDate(date: string): void {
    this.planDate = date; this.calendarSelection = [];
  }
  private shiftPlanDate(amount: number): void {
    try { this.changePlanDate(shiftDay(this.planDate, amount)); } catch (error) { this.notice((error as Error).message, true); }
  }
  private visiblePlans(): PlanItem[] {
    return this.space().plans.filter((item: PlanItem) => item.date === this.planDate &&
      (this.planFilter === 'all' || item.status === this.planFilter))
      .sort((a: PlanItem, b: PlanItem) => Number(b.priority === 'important') - Number(a.priority === 'important'));
  }
  private async deletePlan(): Promise<void> {
    if (await this.commit((_next: Workspace, space: Space) => { removePlan(space, this.planEditId); },
      '事项已从本机计划移除；关联会话保留在独立需求')) {
      this.planEditId = ''; this.planTitle = ''; this.planNote = ''; this.planMinutes = ''; this.confirmPlanDelete = false; this.planPriority = 'normal'; this.planProject = '';
      if (this.route === 'plan-editor') { this.back(); }
    }
  }
  private async setPlan(id: string, status: WorkStatus): Promise<void> {
    await this.commit((_next: Workspace, space: Space) => {
      const item = space.plans.find((plan: PlanItem) => plan.id === id);
      if (!item) { throw new Error('计划不存在'); } item.status = status;
    });
  }
  private async saveRecord(): Promise<void> {
    if (await this.commit((_next: Workspace, space: Space) => {
      space.records.unshift({ id: newId(), text: cleanText(this.recordText), unfinished: this.recordUnfinished,
        energy: this.recordEnergy, decision: this.recordDecision, nextTodo: this.recordTodo,
        start: this.recordStart ? new Date(this.recordStart).getTime() : null,
        end: this.recordEnd ? new Date(this.recordEnd).getTime() : null, createdAt: Date.now(), backfilled: this.backfilled });
    })) {
      this.recordText = ''; this.recordUnfinished = ''; this.recordEnergy = ''; this.recordDecision = ''; this.recordTodo = '';
      this.recordStart = ''; this.recordEnd = ''; this.backfilled = false;
    }
  }
  private selectedNeed(): Need | undefined { return this.space().needs.find((need: Need) => need.id === this.route.split('/')[1]); }
  private selectedProject(): Project | undefined { return this.space().projects.find((project: Project) => project.id === this.route.split('/')[1]); }
  private selectedBook(): ReadingItem | undefined { return this.space().books.find((book: ReadingItem) => book.id === this.route.split('/')[1]); }
  private owner(need: Need): string {
    if (need.ownerKind === 'independent') { return '项目 / 独立需求'; }
    if (need.ownerKind === 'project') { return '项目 / ' + (this.space().projects.find((item: Project) => item.id === need.ownerId)?.name || ''); }
    if (need.ownerKind === 'book') { return '阅读 / ' + (this.space().books.find((item: ReadingItem) => item.id === need.ownerId)?.title || ''); }
    return '计划 / ' + (this.space().plans.find((item: PlanItem) => item.id === need.ownerId)?.title || '');
  }
  private sharePreview(): string {
    let text = contextText([], this.snapshot, { notes: false, calendar: this.shareCalendar, device: this.shareDevice }, Date.now());
    const source = this.space().needs.find((need: Need) => need.id === this.shareNeed);
    if (source) { text += `\n引用会话：${source.name}（${this.owner(source)}），最近 6 条消息\n` + source.messages.slice(-6).map((message: Message) => message.role + ': ' + message.content).join('\n'); }
    return text;
  }
  private preview(): string { try { return this.sharePreview() || '本次不附加外部上下文'; } catch (error) { return (error as Error).message; } }
  private async send(): Promise<void> {
    if (this.busy || !this.ready) { return; }
    this.busy = true;
    const draftKey = this.routeKey();
    this.pendingKey = draftKey; this.pendingPrompt = ''; this.sendError = '';
    try {
      const config = this.data.connection;
      if (!config || this.data.activeServer !== serverKey(config)) { throw new Error('请先切换到已配置的服务器空间；本地收件箱不会自动上传'); }
      const need = this.selectedNeed();
      if (!need) { throw new Error('请先建立或选择需求会话'); }
      const prompt = this.chatDraft;
      const token = await this.credentials.read(config.credentialRef);
      const request = createRequest(config.model, need.messages.slice(-40), prompt, this.sharePreview());
      this.pendingKey = draftKey; this.pendingPrompt = prompt; this.sendError = ''; this.pendingScrolled = false;
      this.sending = true;
      const answer = await this.client.chat(this.settings(config), token, request);
      this.sending = false;
      const next = copyWorkspace(this.data);
      const target = activeSpace(next).needs.find((item: Need) => item.id === need.id);
      if (!target) { throw new Error('需求已不存在'); }
      target.messages.push(request.messages[request.messages.length - 1], { role: 'assistant', content: answer });
      try { await this.repository.save(next); }
      catch {
        this.data = next; this.ready = false; this.pendingPrompt = '';
        throw new Error('已收到回复但本地保存失败，回复仅保留在内存；请复制内容，不要重复发送');
      }
      this.data = next; this.pendingPrompt = '';
      this.drafts.set(draftKey, '');
      if (this.selectedNeed()?.id === need.id) { this.chatDraft = ''; }
      this.shareCalendar = false; this.shareDevice = false; this.shareNeed = '';
      this.notice('回复已保存到本机；服务端会话持久化尚未核验');
    } catch (error) { this.sendError = (error as Error).message; this.notice(this.sendError, true); }
    finally { this.busy = false; this.sending = false; }
  }
  private async refreshCalendar(): Promise<void> {
    await this.loadCalendarDate(dayKey(new Date()));
  }
  private async loadCalendarDate(date: string): Promise<void> {
    if (this.busy) { return; } this.busy = true;
    this.shareCalendar = false; this.shareDevice = false;
    this.snapshot = { calendar: '', device: '', capturedAt: 0 };
    this.calendarEntries = []; this.calendarSelection = []; this.calendarDate = ''; this.calendarError = '';
    try {
      const requestedDate = date;
      const entries = await readCalendarEntries(this.context(), requestedDate);
      this.calendarEntries = entries; this.calendarDate = requestedDate;
      this.snapshot = { calendar: requestedDate === dayKey(new Date()) ? calendarText(entries) : '', device: deviceSnapshot(), capturedAt: Date.now() };
      this.notice('已读取到本机；本次分享及周期自动化授权仍独立，当前不自动上传');
    } catch (error) { this.calendarError = (error as Error).message; this.notice(this.calendarError, true); }
    finally { this.busy = false; }
  }
  private async importCalendar(): Promise<void> {
    if (!this.calendarSelection.length) { return; }
    if (this.calendarDate !== this.planDate) { this.notice('查看日期已变化，请刷新对应日历', true); return; }
    let added = 0;
    if (await this.commit((_next: Workspace, space: Space) => {
      added = importCalendarPlans(space, this.calendarEntries, this.calendarSelection, this.calendarDate, '');
    }, '')) {
      this.planDate = this.calendarDate; this.calendarSelection = [];
      this.notice(`已加入 ${added} 条计划，重复事项已跳过`);
    }
  }
  private async addReminder(): Promise<void> {
    if (this.busy || !this.ready) { return; } this.busy = true;
    let id = -1;
    try {
      const next = copyWorkspace(this.data);
      if (activeSpace(next).reminders.length >= 20) { throw new Error('最多保存 20 个系统提醒，请先整理'); }
      id = await publishReminder(this.context(), this.reminderTitle, this.reminderTime, this.weekdays);
      activeSpace(next).reminders.push({ id: newId(), title: this.reminderTitle, time: this.reminderTime, weekdays: this.weekdays, reminderId: id });
      await this.repository.save(next); this.data = next; this.reminderTitle = '';
      this.notice('系统提醒已注册；不保证突破免打扰，不会自动生成日报或执行 Agent');
    } catch (error) {
      this.notice((error as Error).message, true);
      if (id >= 0) { try { await cancelReminder(id); } catch { this.notice('保存失败且系统提醒未撤销，请检查系统提醒 ID ' + id, true); } }
    } finally { this.busy = false; }
  }
  private async removeReminder(task: Task): Promise<void> {
    if (this.busy || !this.ready) { return; } this.busy = true;
    try {
      await cancelReminder(task.reminderId);
      const next = copyWorkspace(this.data);
      activeSpace(next).reminders = activeSpace(next).reminders.filter((item: Task) => item.id !== task.id);
      await this.repository.save(next); this.data = next; this.notice('系统提醒已取消');
    } catch { this.notice('取消或保存失败，条目保留，请检查系统提醒状态', true); }
    finally { this.busy = false; }
  }

  @Styles
  surface() { .padding(16).width('100%').borderRadius(16).backgroundColor($r('app.color.bg_surface')).margin({ bottom: 12 }) }
  @Styles
  field() {
    .width('100%').constraintSize({ minHeight: 48 }).borderRadius(12).backgroundColor($r('app.color.bg_surface'))
      .border({ width: 1, color: $r('app.color.border_control') })
      .stateStyles({
        focused: {
          .border({ width: 2, color: $r('app.color.focus') })
        }
      })
  }
  @Builder
  body(text: string) { Text(text).fontSize(16).lineHeight(24).fontColor($r('app.color.text_primary')).width('100%') }
  @Builder
  hint(text: string) { Text(text).fontSize(14).lineHeight(21).fontColor($r('app.color.text_secondary')).width('100%') }
  @Builder
  section(title: string) { Text(title).fontSize(18).fontWeight(FontWeight.Medium).fontColor($r('app.color.text_primary')).margin({ top: 24, bottom: 12 }) }
  @Builder
  action(label: string, action: () => void, primary: boolean = false) {
    WorkspaceAction({ label: label, action: action, primary: primary, active: this.ready && !this.busy }).margin({ top: 8, bottom: 4 })
  }
  @Builder
  link(label: string, action: () => void) {
    WorkspaceAction({ label: label, action: action, active: this.loaded }).margin({ top: 8, bottom: 4 })
  }
  @Builder
  input(label: string, value: string, change: (value: string) => void, placeholder: string = label) {
    this.hint(label)
    TextInput({ text: value, placeholder: placeholder }).id('input-' + label).field().fontSize(16)
      .fontColor($r('app.color.text_primary')).placeholderColor($r('app.color.text_secondary')).enabled(!this.busy)
      .onChange(change).margin({ top: 4, bottom: 12 })
  }
  @Builder
  area(label: string, value: string, change: (value: string) => void) {
    this.hint(label)
    TextArea({ text: value, placeholder: label }).id('input-' + label).field()
      .constraintSize({ minHeight: 96, maxHeight: 160 }).maxLength(4000)
      .fontSize(16).fontColor($r('app.color.text_primary')).placeholderColor($r('app.color.text_secondary'))
      .enabled(!this.busy).onChange(change).margin({ top: 4, bottom: 12 })
  }
  @Builder
  check(label: string, value: boolean, change: (value: boolean) => void) {
    Row({ space: 8 }) {
      Checkbox({ name: label }).select(value).width(24).height(24).margin(12)
        .selectedColor($r('app.color.action_primary')).enabled(!this.busy).onChange(change).accessibilityText(label)
      Text(label).fontSize(16).fontColor($r('app.color.text_primary')).layoutWeight(1)
    }.width('100%').constraintSize({ minHeight: 48 })
  }
  @Builder
  projectPicker(value: string, change: (value: string) => void) {
    this.action((value === '' ? '✓ ' : '') + '独立 / 未归入项目', () => { change(''); })
    ForEach(this.space().projects, (project: Project) => {
      this.action((value === project.id ? '✓ ' : '') + project.name, () => { change(project.id); })
    }, (project: Project) => project.id)
  }
  @Builder
  planCard(item: PlanItem) {
    DailyPlanCard({ item: this.space().plans.find((plan: PlanItem) => plan.id === item.id) || item, writable: this.ready && !this.busy,
      projectName: this.space().projects.find((project: Project) => project.id ===
        this.space().plans.find((plan: PlanItem) => plan.id === item.id)?.projectId)?.name || '',
      changeStatus: (id: string, status: WorkStatus) => { this.setPlan(id, status); },
      edit: (id: string) => { this.editPlan(id); },
      discuss: (id: string) => {
        const plan = this.space().plans.find((value: PlanItem) => value.id === id);
        if (plan) { this.openLinked(plan.title, 'plan', id); }
      }
    })
  }
  @Builder
  projectCard(project: Project) {
    Column({ space: 8 }) {
      this.body(project.name)
      this.hint((project.managedBy === 'manual' ? '手工托管' : 'Agent 托管') + ' · PARA Vault 尚待接入')
      this.hint(`已完成 ${this.space().plans.filter((item: PlanItem) => item.projectId === project.id && item.status === 'done').length} / ${this.space().plans.filter((item: PlanItem) => item.projectId === project.id).length} 项本机任务`)
      this.hint('下一步：' + (project.nextStep || '尚未填写'))
      this.link('项目详情与会话', () => { this.go('project/' + project.id); })
    }.alignItems(HorizontalAlign.Start).surface()
  }
  @Builder
  bookCard(book: ReadingItem) {
    Column({ space: 8 }) {
      this.body(book.title)
      this.hint('阅读进度：' + (book.progress === null ? '尚未获取' : book.progress))
      this.hint(`笔记 ${book.notes === null ? '尚未获取' : book.notes} · 划线 ${book.highlights === null ? '尚未获取' : book.highlights}`)
      this.hint(`想法 ${book.thoughts === null ? '尚未获取' : book.thoughts} · 周总结 ${book.weeklySummaries === null ? '尚未获取' : book.weeklySummaries}`)
      this.hint(book.source + ' · ' + new Date(book.updatedAt).toLocaleString())
      this.link('阅读详情与会话', () => { this.go('book/' + book.id); })
    }.alignItems(HorizontalAlign.Start).surface()
  }
  @Builder
  home() {
    SectionHeading({ title: '今天，把事情往前推进', subtitle: new Date().toLocaleDateString() })
    this.section('今日计划')
    Text(`本机今日事务：完成 ${planCounts(this.space(), dayKey(new Date()))[0]} · 进行中 ${planCounts(this.space(), dayKey(new Date()))[1]} · 待完成 ${planCounts(this.space(), dayKey(new Date()))[2]}（不含日历事项）`).fontSize(14).lineHeight(21).fontColor($r('app.color.text_secondary'))
    ForEach(this.space().plans.filter((item: PlanItem) => item.date === dayKey(new Date())).slice(0, 3), (item: PlanItem) => { this.planCard(item) }, (item: PlanItem) => item.id)
    this.action('制定与查看每日计划', () => { this.changePlanDate(dayKey(new Date())); this.go('plans'); }, true)
    this.hint('周期记录：工作时段与强提醒策略待确认，未配置下一次周期提醒。')
    this.link('记录进展与精力', () => { this.go('record'); })
    this.section('项目进展')
    if (!this.space().projects.length) { this.hint('还没有项目，从一个目标开始。') }
    ForEach(this.space().projects.slice(0, 2), (project: Project) => { this.projectCard(project) }, (project: Project) => project.id)
    this.link('全部项目', () => { this.switchTab(1); })
    this.section('最近在读')
    if (!this.space().books.length) { this.hint('尚未获取阅读资料，微信读书 Skill 与业务同步待联调。') }
    ForEach(this.space().books.slice(0, 2), (book: ReadingItem) => { this.bookCard(book) }, (book: ReadingItem) => book.id)
    this.link('阅读概览', () => { this.switchTab(2); })
  }
  @Builder
  projects() {
    SectionHeading({ title: '项目', subtitle: '目标、需求、任务和成果，放回同一个上下文。' })
    this.action('新建项目', () => { this.go('new-project'); }, true)
    ForEach(this.space().projects, (project: Project) => { this.projectCard(project) }, (project: Project) => project.id)
    this.section('独立需求')
    this.hint('没有明确目标，也可以建立独立的“漫无目的”会话。')
    ForEach(this.space().needs.filter((need: Need) => need.ownerKind === 'independent'), (need: Need) => { this.needCard(need) }, (need: Need) => need.id)
    this.action('发起独立需求', () => { this.needProject = ''; this.go('new-need'); })
  }
  @Builder
  needCard(need: Need) {
    Column({ space: 4 }) {
      this.body(need.name)
      this.hint(this.owner(need) + ' · ' + new Date(need.createdAt).toLocaleString())
      this.link('继续会话', () => { this.go('chat/' + need.id); })
    }.alignItems(HorizontalAlign.Start).surface()
  }
  @Builder
  projectDetail(project: Project) {
    SectionHeading({ title: project.name, subtitle: project.managedBy === 'manual' ? '手工托管 · PARA' : 'Agent 托管 · PARA' })
    this.body(project.goal)
    this.input('下一步', this.projectNextStep, (value: string) => { this.projectNextStep = value; this.projectDrafts.set(this.data.activeServer + '/' + this.route, value); })
    this.action('保存下一步', () => { this.commit((_next: Workspace, space: Space) => {
      const target = space.projects.find((item: Project) => item.id === project.id);
      if (target) { target.nextStep = this.projectNextStep; }
    }); })
    this.section('需求会话')
    ForEach(this.space().needs.filter((need: Need) => need.ownerKind === 'project' && need.ownerId === project.id), (need: Need) => { this.needCard(need) }, (need: Need) => need.id)
    this.action('新建项目需求', () => { this.needProject = project.id; this.go('new-need'); })
    this.section('任务')
    ForEach(this.space().plans.filter((item: PlanItem) => item.projectId === project.id), (item: PlanItem) => { this.planCard(item) }, (item: PlanItem) => item.id)
    this.action('添加项目任务', () => { this.planDate = dayKey(new Date()); this.newPlan(); this.planProject = project.id; })
    this.section('成果、知识与 Agent 运行')
    this.hint('远端执行、双 Vault 写入和部署回执待协议联调。聊天建议不会自动标为成果或部署成功。')
    this.link('查看集成状态', () => { this.go('integrations'); })
  }
  @State projectNextStep: string = '';
  @Builder
  newProject() {
    SectionHeading({ title: '新建项目', subtitle: '从目标和完成标准开始。' })
    this.input('项目名称', this.projectName, (value: string) => { this.projectName = value; })
    this.area('目标 / 完成标准', this.projectGoal, (value: string) => { this.projectGoal = value; })
    this.check('Agent 托管（不自动授予写入或部署权限）', this.managedBy === 'agent', (value: boolean) => { this.managedBy = value ? 'agent' : 'manual'; })
    this.action('创建项目', () => { this.addProject(); }, true)
  }
  @Builder
  newNeed() {
    SectionHeading({ title: '发起需求', subtitle: '名称留空即为“漫无目的”，每次建立独立会话。' })
    this.input('需求名称（可选）', this.needName, (value: string) => { this.needName = value; })
    this.area('起始描述（进入会话后确认发送）', this.needDescription, (value: string) => { this.needDescription = value; })
    this.section('归属')
    this.projectPicker(this.needProject, (value: string) => { this.needProject = value; })
    this.action('建立需求会话', () => { this.addNeed(); }, true)
  }
  @Builder
  planProjectPicker() {
    WorkspaceAction({ label: (this.planProject === '' ? '✓ ' : '') + '独立 / 未归入项目', active: this.ready && !this.busy,
      action: () => { this.planProject = ''; } }).margin({ bottom: 8 })
    ForEach(this.space().projects, (project: Project) => {
      WorkspaceAction({ label: (this.planProject === project.id ? '✓ ' : '') + project.name, active: this.ready && !this.busy,
        action: () => { this.planProject = project.id; } }).margin({ bottom: 8 })
    }, (project: Project) => project.id)
  }
  @Builder
  planEditor() {
    SectionHeading({ title: this.planEditId ? '编辑计划' : '添加计划', subtitle: '保存到本机；返回和保存失败均保留输入。' })
    this.input('计划日期 YYYY-MM-DD', this.planEditDate, (value: string) => { this.planEditDate = value; })
    if (this.space().plans.find((item: PlanItem) => item.id === this.planEditId)?.calendarSource) {
      this.hint('此事项来自手机日历，日期须与原计划一致；编辑仅修改本机副本。')
    }
    this.input('计划事项（1–200 字）', this.planTitle, (value: string) => { this.planTitle = value; }, '例如：阅读第 3 章并整理笔记')
    this.check('重要事项', this.planPriority === 'important', (value: boolean) => { this.planPriority = value ? 'important' : 'normal'; })
    this.input('预计用时（可选，分钟）', this.planMinutes, (value: string) => { this.planMinutes = value; })
    this.area('补充说明（可选）', this.planNote, (value: string) => { this.planNote = value; })
    this.section('所属项目')
    this.planProjectPicker()
    this.action(this.planEditId ? '保存修改' : '添加到当日计划', () => { this.addPlan(); }, true)
    if (this.planEditId) {
      this.action('移除计划事项', () => { this.confirmPlanDelete = true; })
      if (this.confirmPlanDelete) {
        this.hint('确认从本机移除此事项？关联会话与消息将保留为独立需求，系统日历原事件不受影响。')
        this.action('确认移除', () => { this.deletePlan(); })
        this.action('保留事项', () => { this.confirmPlanDelete = false; })
      }
    }
  }
  @Builder
  plans() {
    SectionHeading({ title: '每日计划', subtitle: '安排当天行动，逐项确认状态；数据保存在当前空间的本机副本。' })
    Row({ space: 8 }) {
      Button('前一天').backgroundColor($r('app.color.selection_bg')).fontColor($r('app.color.selection_text')).constraintSize({ minHeight: 48 }).layoutWeight(1).enabled(!this.busy).onClick(() => { this.shiftPlanDate(-1); })
      Button('今天').backgroundColor($r('app.color.selection_bg')).fontColor($r('app.color.selection_text')).constraintSize({ minHeight: 48 }).layoutWeight(1).enabled(!this.busy).onClick(() => { this.changePlanDate(dayKey(new Date())); })
      Button('后一天').backgroundColor($r('app.color.selection_bg')).fontColor($r('app.color.selection_text')).constraintSize({ minHeight: 48 }).layoutWeight(1).enabled(!this.busy).onClick(() => { this.shiftPlanDate(1); })
    }.width('100%')
    this.input('查看日期 YYYY-MM-DD', this.planDate, (value: string) => { this.changePlanDate(value); })
    if (!validDate(this.planDate)) {
      Text('请输入有效日期后查看计划。').fontColor($r('app.color.status_error')).fontSize(14)
    } else {
      Text(`事务：完成 ${planCounts(this.space(), this.planDate)[0]} · 进行中 ${planCounts(this.space(), this.planDate)[1]} · 待完成 ${planCounts(this.space(), this.planDate)[2]}`)
        .fontSize(16).lineHeight(24).fontColor($r('app.color.text_primary'))
      Text(`已加入日历事项占用 ${calendarBusyMinutes(this.space(), this.planDate)} 分钟（重叠去重，全天单列）；不计入事务完成统计。`)
        .fontSize(14).lineHeight(21).fontColor($r('app.color.text_secondary'))
      this.action('添加计划', () => { this.newPlan(); }, true)
      this.section('当日事项')
      Row({ space: 4 }) {
        ForEach(['all', 'todo', 'doing', 'done'], (filter: string) => {
          Button((this.planFilter === filter ? '✓ ' : '') + (filter === 'all' ? '全部' : filter === 'todo' ? '待完成' : filter === 'doing' ? '进行中' : '已完成'))
            .fontSize(14).layoutWeight(1).constraintSize({ minHeight: 48 }).borderRadius(12)
            .backgroundColor($r('app.color.selection_bg')).fontColor($r('app.color.selection_text'))
            .onClick(() => { this.planFilter = filter; })
        }, (filter: string) => filter)
      }.width('100%').margin({ bottom: 12 })
      if (!this.visiblePlans().length) {
        Text(this.space().plans.some((item: PlanItem) => item.date === this.planDate) ? '当前状态下没有事项，可切换到全部。' : '这一天还没有计划。添加一件想推进的事，或从下方建议逐项采纳。')
          .fontSize(16).lineHeight(24).fontColor($r('app.color.text_secondary'))
      }
      ForEach(this.visiblePlans(), (item: PlanItem) => { this.planCard(item) }, (item: PlanItem) => item.id)
      this.section('日历安排 · 手机日历')
      Text(this.calendarDate === this.planDate ? `${this.calendarDate} · ${this.calendarEntries.length} 条日程，由你选择重要事项` : '尚未读取所选日期日历。').fontSize(14).lineHeight(21)
        .fontColor($r('app.color.text_secondary'))
      if (this.calendarError) { Text(this.calendarError).fontSize(14).lineHeight(21).fontColor($r('app.color.status_error')) }
      this.action(this.busy ? '正在处理…' : '授权并刷新所选日期日历', () => { this.loadCalendarDate(this.planDate); })
      if (this.calendarDate === this.planDate) {
        Text('采集于 ' + new Date(this.snapshot.capturedAt).toLocaleString() + ' · 本机快照，非日历实时同步').fontSize(14).lineHeight(21).fontColor($r('app.color.text_secondary'))
        ForEach(this.calendarEntries, (entry: CalendarEntry) => {
          Column({ space: 4 }) {
            this.check(entry.title, this.calendarSelection.includes(entry.key), (selected: boolean) => {
              this.calendarSelection = selected ? this.calendarSelection.concat(entry.key) : this.calendarSelection.filter((key: string) => key !== entry.key);
            })
            Text(entry.allDay ? '全天' : new Date(entry.start).toLocaleString() + ' — ' + new Date(entry.end).toLocaleString())
              .fontSize(14).lineHeight(21).fontColor($r('app.color.text_secondary'))
            if (this.space().plans.some((plan: PlanItem) => plan.calendarSource?.key === entry.key)) {
              Text('已加入计划 · 再次导入将跳过').fontSize(14).fontColor($r('app.color.status_success'))
            }
          }.surface()
        }, (entry: CalendarEntry) => entry.key)
        if (this.calendarSelection.length) {
          this.hint('所选日程将作为独立日历事项加入所选日期，不自动完成、不修改系统日历。')
          this.action('确认加入所选日程', () => { this.importCalendar(); })
        }
      }
      this.section('历史建议 · 本机规则')
      this.hint('回看所选日期之前 7 天未完成事务和记录中的新增待办。逐项采纳会新建待完成事项，原事项保留；相同来源同日不会重复采纳。')
      if (!planSuggestions(this.space(), this.planDate).length) {
        this.hint('暂无可采纳建议。记录中超过 200 字的待办请先在记录页拆分后手动添加。')
      }
      ForEach(planSuggestions(this.space(), this.planDate), (suggestion: PlanSuggestion) => {
        Column({ space: 8 }) {
          Text(suggestion.title).fontSize(16).lineHeight(24).fontColor($r('app.color.text_primary'))
          Text(suggestion.reason).fontSize(14).lineHeight(21).fontColor($r('app.color.text_secondary'))
          this.action('采纳到 ' + this.planDate, () => {
            this.commit((_next: Workspace, space: Space) => { adoptPlanSuggestion(space, this.planDate, suggestion.key); });
          })
        }.surface()
      }, (suggestion: PlanSuggestion) => suggestion.key)
      this.link('查看记录与本机汇总', () => { this.reportDate = this.planDate; this.go('report'); })
      this.section('晚间制定计划提醒')
      this.hint('可配置普通系统每日提醒；锁屏强提醒与点击直达每日计划待设备接入验证。')
      this.link('配置制定计划提醒', () => { this.reminderTitle = '制定明日计划'; this.go('reminders'); })
      this.hint('远端 AI 个性化建议、自动日报与多端同步尚未接入。')
    }
  }
  @Builder
  record() {
    SectionHeading({ title: '记录进展与精力', subtitle: '可以只写正文；发生区间与保存时间分开。' })
    this.area('完成了什么 / 快速记录', this.recordText, (value: string) => { this.recordText = value; })
    this.input('开始时间（可选，如 2026-10-01T09:00）', this.recordStart, (value: string) => { this.recordStart = value; })
    this.input('结束时间（与开始同时填写）', this.recordEnd, (value: string) => { this.recordEnd = value; })
    this.input('未完成事项（可选）', this.recordUnfinished, (value: string) => { this.recordUnfinished = value; })
    this.input('精力自述（可选，量表待确认）', this.recordEnergy, (value: string) => { this.recordEnergy = value; })
    this.input('决策（可选）', this.recordDecision, (value: string) => { this.recordDecision = value; })
    this.input('新增待办（可选）', this.recordTodo, (value: string) => { this.recordTodo = value; })
    this.check('这是补记', this.backfilled, (value: boolean) => { this.backfilled = value; })
    this.action('仅保存到本机收件箱', () => { this.saveRecord(); }, true)
    this.link('查看收件箱', () => { this.go('inbox'); })
  }
  @Builder
  inbox() {
    SectionHeading({ title: '本机收件箱', subtitle: '保存记录不要求立即对话；交给 Hermes 前建立需求。' })
    ForEach(this.space().records, (record: IntervalRecord) => {
      Column({ space: 8 }) {
        this.hint(new Date(record.createdAt).toLocaleString() + (record.backfilled ? ' · 补记' : '') + ' · 保存时间')
        this.body(record.text)
        this.action('建立需求后交给 Hermes', () => { this.needDescription = record.text; this.go('new-need'); })
        if (record.nextTodo) { this.action('确认新增待办为计划', () => { this.planDate = dayKey(new Date()); this.newPlan(); this.planTitle = record.nextTodo; }) }
      }.alignItems(HorizontalAlign.Start).surface()
    }, (record: IntervalRecord) => record.id)
    if (!this.space().records.length) { this.hint('还没有记录，写一句就好。') }
    this.link('记一笔', () => { this.go('record'); })
  }
  @Builder
  report() {
    SectionHeading({ title: '记录与日报', subtitle: '以下为原始记录的本机汇总；自动精力日报模板待确认。' })
    this.input('日期 YYYY-MM-DD', this.reportDate, (value: string) => { this.reportDate = value; })
    Text(dailyReport(this.space(), this.reportDate)).fontSize(16).lineHeight(24).fontColor($r('app.color.text_primary')).copyOption(CopyOptions.InApp)
    this.link('查看来源记录', () => { this.go('inbox'); })
    this.link('参考汇总制定计划', () => { this.go('plans'); })
  }
  @Builder
  reading() {
    SectionHeading({ title: '阅读', subtitle: '阅读位置与内容产出分开统计，不评估理解程度。' })
    if (!this.space().books.length) {
      this.hint('尚未获取书籍。微信读书与 IMA 服务端链路待核验，不填充示例进度。')
      this.link('查看数据源与连接', () => { this.go('integrations'); })
    }
    ForEach(this.space().books, (book: ReadingItem) => { this.bookCard(book) }, (book: ReadingItem) => book.id)
    this.section('整理工作流')
    this.hint('定时整理、下次运行、总结去重口径与 IMA 写入结果尚待服务端联调。')
  }
  @Builder
  bookDetail(book: ReadingItem) {
    SectionHeading({ title: book.title, subtitle: book.source })
    this.bookCard(book)
    this.section('原始摘抄与笔记')
    ForEach(book.excerpts, (text: string) => { this.body(text) })
    this.section('总结')
    ForEach(book.summaries, (text: string) => { this.body(text) })
    this.action('继续阅读需求会话', () => { this.openLinked(book.title, 'book', book.id); }, true)
  }
  @Builder
  chat(need: Need) {
    SectionHeading({ title: need.name, subtitle: this.owner(need) })
    this.hint('本机历史完整保存。兼容文本接口本次携带最近 40 条；服务端持久化与运行恢复待联调。')
    this.action('重命名或归入项目', () => { this.rename = need.name; this.moveProject = need.ownerKind === 'project' ? need.ownerId : ''; this.go('move/' + need.id); })
    // Read the current @State workspace in the update callback, not the builder's entry-time snapshot.
    ForEach(this.selectedNeed()?.messages ?? [], (message: Message, index: number) => {
      Column({ space: 8 }) {
        this.hint(message.role === 'user' ? '你' : 'Hermes · AI 生成')
        Text(message.content).fontSize(16).lineHeight(24).fontColor($r('app.color.text_primary')).copyOption(CopyOptions.InApp)
      }.alignItems(HorizontalAlign.Start).surface().backgroundColor(message.role === 'user' ? $r('app.color.selection_bg') : $r('app.color.bg_surface'))
    }, (_message: Message, index: number) => String(index))
    if (this.pendingKey === this.routeKey()) {
      if (this.pendingPrompt) {
        Column({ space: 8 }) {
          Text('你').fontSize(14)
          Text(this.pendingPrompt).copyOption(CopyOptions.InApp)
        }.surface().backgroundColor($r('app.color.selection_bg'))
          .onAreaChange((_old: Area, area: Area) => {
            if (this.sending && !this.pendingScrolled) {
              this.pendingScrolled = true;
              this.scroller.scrollTo({ xOffset: 0, yOffset: Number(area.position.y) });
            }
          })
      }
      if (this.sending) {
        Row({ space: 8 }) { LoadingProgress().width(24).height(24); Text('正在等待 Hermes…') }
        WorkspaceAction({ label: '停止等待（服务端可能继续执行）', action: () => { this.client.stop(); } })
      }
      if (this.sendError) { Text(this.sendError).fontColor($r('app.color.status_error')).copyOption(CopyOptions.InApp) }
    }
    this.section('本次上下文授权')
    this.check('分享今日日历快照', this.shareCalendar, (value: boolean) => { this.shareCalendar = value; })
    this.check('分享设备快照', this.shareDevice, (value: boolean) => { this.shareDevice = value; })
    this.action('读取快照', () => { this.refreshCalendar(); })
    this.hint('可选：引用另一个本服务器会话最近 6 条消息；选择即允许本次发送，跨项目来源明确展示。')
    this.action((this.shareNeed ? '' : '✓ ') + '不引用其他会话', () => { this.shareNeed = ''; })
    ForEach(this.space().needs.filter((item: Need) => item.id !== need.id), (source: Need) => {
      this.action((this.shareNeed === source.id ? '✓ ' : '') + this.owner(source) + ' / ' + source.name, () => { this.shareNeed = source.id; })
    }, (source: Need) => source.id)
    this.hint(this.preview())
    this.hint('分享内容会发送给 Hermes 及其模型服务，并保存在该需求历史中；后续可能继续携带。不会授予跨项目写入或部署权限。')
    this.area('继续这个需求', this.chatDraft, (value: string) => { this.chatDraft = value; })
    this.action('发送给 Hermes', () => { this.send(); }, true)
    this.section('任务 / 运行 / 成果')
    this.hint('生成建议不等于任务执行。运行事件、成果与部署状态需要服务端真实回执。')
    ForEach(this.space().runs.filter((run: AgentRun) => run.needId === need.id), (run: AgentRun) => { this.runCard(run) }, (run: AgentRun) => run.id)
  }
  @Builder
  runCard(run: AgentRun) {
    Column({ space: 8 }) {
      this.body('运行 ' + run.id + ' · ' + run.status)
      this.hint('最后事件：' + new Date(run.updatedAt).toLocaleString() + ' · 本机副本可能过期')
      ForEach(run.events, (event: RunEvent) => {
        this.hint(new Date(event.at).toLocaleString() + ' · ' + event.agent)
        this.body(event.message)
      }, (event: RunEvent) => event.id)
      this.section('成果')
      ForEach(run.artifacts, (artifact: string) => { this.body(artifact) })
      this.hint('部署回执：' + (run.deployment || '尚未收到'))
    }.alignItems(HorizontalAlign.Start).surface()
  }
  @Builder
  move() {
    SectionHeading({ title: '整理需求', subtitle: '保留原会话标识与历史，移动后归属改变。' })
    this.input('需求名称', this.rename, (value: string) => { this.rename = value; })
    this.projectPicker(this.moveProject, (value: string) => { this.moveProject = value; })
    this.action('保存名称与归属', () => { this.commit((_next: Workspace, space: Space) => {
      moveNeed(space, this.route.split('/')[1], this.rename, this.moveProject);
    }).then((saved: boolean) => { if (saved) { this.back(); } }); }, true)
  }
  @Builder
  profile() {
    SectionHeading({ title: '我的', subtitle: '个人事务的统一入口，连接你自己部署的 Hermes。' })
    this.section('Agent 连接')
    this.body(this.data.connection?.name || '尚未配置')
    this.hint(this.connectionStatus)
    this.hint('当前空间：' + this.data.activeServer)
    this.hint(this.space().lastSyncAt === null ? '尚未业务同步 · 当前为本机副本' : '最后同步：' + new Date(this.space().lastSyncAt as number).toLocaleString())
    this.action('管理连接', () => { this.go('connection'); }, true)
    this.action('查看本地迁移收件箱', () => {
      this.commit((next: Workspace) => { next.activeServer = 'local'; }, '已切换到本地空间，不自动上传历史记录').then((saved: boolean) => { if (saved) { this.go('inbox'); } });
    })
    if (this.data.connection && this.data.activeServer === 'local') {
      this.action('返回已配置的服务器空间', () => { this.commit((next: Workspace) => { next.activeServer = serverKey(next.connection as Connection); }); })
    }
    this.section('数据来源与授权')
    this.link('日历 / 健康 / 微信读书 / IMA', () => { this.go('integrations'); })
    this.section('知识空间')
    this.hint('手工托管 Vault：学习、鸿蒙及设备实践。Agent 托管 Vault：远端工程与实践。两者采用 PARA，写入权限尚待核验。')
    this.section('提醒与报告')
    this.link('系统提醒与周期策略', () => { this.go('reminders'); })
    this.link('记录与日报', () => { this.go('report'); })
    this.section('显示模式（保存到本机）')
    ForEach(['跟随系统', '浅色', '深色'], (label: string, index: number) => {
      this.action((this.data.appearance === index ? '✓ ' : '') + label, () => {
        this.commit((next: Workspace) => { next.appearance = index; }, '显示偏好已保存').then((saved: boolean) => {
          if (saved) { try { this.applyAppearance(index); } catch { this.notice('偏好已保存，当前系统切换失败，重启后重试', true); } }
        });
      })
    })
  }
  @Builder
  connection() {
    SectionHeading({ title: 'Agent 连接', subtitle: '保存、测试、连接与同步分别反馈。Token 使用系统安全存储。' })
    this.input('连接名称', this.name, (value: string) => { this.name = value; })
    this.input('IP / 域名（不含协议与端口）', this.host, (value: string) => { this.host = value; })
    this.check('HTTPS（关闭则为 HTTP）', this.protocol === 'https', (value: boolean) => { this.protocol = value ? 'https' : 'http'; })
    this.input('端口', this.port, (value: string) => { this.port = value; })
    this.input('API 基础路径（可选）', this.basePath, (value: string) => { this.basePath = value; })
    this.input('文本模型', this.model, (value: string) => { this.model = value; })
    this.hint('Token · 安全保存，不进入普通配置')
    TextInput({ text: this.token, placeholder: 'Token' }).type(this.showToken ? InputType.Normal : InputType.Password).field()
      .fontColor($r('app.color.text_primary')).placeholderColor($r('app.color.text_secondary')).fontSize(16).enabled(!this.busy)
      .onChange((value: string) => { this.token = value; })
    this.check('显示 Token', this.showToken, (value: boolean) => { this.showToken = value; })
    this.check('明确允许受信任私有网络 HTTP', this.allowHttp, (value: boolean) => { this.allowHttp = value; })
    this.hint('HTTP 不加密；仅支持内网、回环及 Tailscale 100.64/10 地址，需自行确认网络受信任。')
    this.check('下次打开时连接此 Agent（不重放任务）', this.autoConnect, (value: boolean) => { this.autoConnect = value; })
    this.action('测试当前输入', () => { this.testConnection(); })
    this.action('保存配置', () => { this.saveConnection(false); })
    this.action('保存并连接', () => { this.saveConnection(true); }, true)
    this.hint('更换地址后使用独立数据空间。旧数据保留，草稿不自动转移或发送；配置和同步不是同一状态。')
  }
  @Builder
  integrations() {
    SectionHeading({ title: '数据来源与能力', subtitle: '读取、本次分享和周期工作流分别授权；不以一次分享视为永久许可。' })
    this.section('手机日历 / 设备快照')
    Text(this.snapshot.calendar || '尚未读取，不代表权限已拒绝').fontSize(14).lineHeight(21)
      .fontColor($r('app.color.text_secondary')).width('100%')
    if (this.snapshot.capturedAt) {
      Text('采集于 ' + new Date(this.snapshot.capturedAt).toLocaleString() + ' · 有效期 10 分钟').fontSize(14).lineHeight(21)
        .fontColor($r('app.color.text_secondary')).width('100%')
    }
    this.action('按需授权并刷新', () => { this.refreshCalendar(); })
    ForEach(this.capabilities, (item: IntegrationCapability) => {
      Column({ space: 8 }) { this.body(item.title); this.hint(item.status); this.hint(item.requirement) }.alignItems(HorizontalAlign.Start).surface()
    }, (item: IntegrationCapability) => item.id)
  }
  @Builder
  reminders() {
    SectionHeading({ title: '提醒与报告', subtitle: '周期支持目标为每小时 / 每两小时 / 半天；工作时段、模板和强提醒策略尚待评审。' })
    this.hint('现可创建普通系统每日提醒；不冒充直达区间的周期强提醒。')
    this.input('提醒内容', this.reminderTitle, (value: string) => { this.reminderTitle = value; })
    this.input('提醒时间 HH:mm', this.reminderTime, (value: string) => { this.reminderTime = value; })
    this.check('仅周一至周五', this.weekdays, (value: boolean) => { this.weekdays = value; })
    this.action('创建普通系统提醒', () => { this.addReminder(); }, true)
    ForEach(this.space().reminders, (task: Task) => {
      Column({ space: 8 }) {
        this.body(task.title); this.hint(task.time + (task.weekdays ? ' · 工作日' : ' · 每天') + ' · 已注册配置')
        this.action('取消提醒', () => { this.removeReminder(task); })
      }.alignItems(HorizontalAlign.Start).surface()
    }, (task: Task) => task.id)
  }
  @Builder
  navigation(index: number) {
    WorkspaceNavigationItem({
      label: this.labels[index], icon: this.icons[index], selected: this.tab === index,
      navigationId: 'main-navigation-' + index, select: () => { this.switchTab(index); }
    })
  }
  @Builder
  content() {
    Scroll(this.scroller) {
      Column() {
        if (this.route) { this.link('返回', () => { this.back(); }) }
        if (!this.ready) { this.hint('本机数据未就绪；若读取失败，请重新打开应用。未用空数据覆盖旧文件。') }
        if (this.loaded && this.route === 'new-project') { this.newProject() }
        else if (this.route.startsWith('project/') && this.selectedProject()) { this.projectDetail(this.selectedProject() as Project) }
        else if (this.route === 'new-need') { this.newNeed() }
        else if (this.route.startsWith('chat/') && this.selectedNeed()) { this.chat(this.selectedNeed() as Need) }
        else if (this.route.startsWith('move/')) { this.move() }
        else if (this.route === 'plans') { this.plans() }
        else if (this.route === 'plan-editor') { this.planEditor() }
        else if (this.route === 'record') { this.record() }
        else if (this.route === 'inbox') { this.inbox() }
        else if (this.route === 'report') { this.report() }
        else if (this.route === 'connection') { this.connection() }
        else if (this.route === 'integrations') { this.integrations() }
        else if (this.route === 'reminders') { this.reminders() }
        else if (this.route.startsWith('book/') && this.selectedBook()) { this.bookDetail(this.selectedBook() as ReadingItem) }
        else if (this.loaded && this.tab === 0) { this.home() }
        else if (this.loaded && this.tab === 1) { this.projects() }
        else if (this.loaded && this.tab === 2) { this.reading() }
        else if (this.loaded) { this.profile() }
        if (this.ready && !this.route) {
          this.section('记录 / 发起需求')
          this.link('记一笔', () => { this.go('record'); })
          this.action('发起需求', () => { this.needProject = ''; this.go('new-need'); })
        }
      }.width('100%').constraintSize({ maxWidth: 720 }).padding(this.availableWidth >= 600 ? 24 : 16).alignItems(HorizontalAlign.Start)
    }.id('workspace-scroll').width('100%').height('100%').align(Alignment.Top)
  }
  build() {
    Column() {
      Row() {
        Text('HermesEye').fontSize(18).fontColor($r('app.color.action_primary')).layoutWeight(1)
        Button('Agent 状态', { type: ButtonType.Normal }).constraintSize({ minHeight: 48 }).fontSize(14)
          .backgroundColor($r('app.color.selection_bg')).fontColor($r('app.color.selection_text'))
          .onClick(() => { this.switchTab(3); })
      }.padding({ left: 16, right: 16 }).width('100%')
      Row() {
        if (this.availableWidth >= 840) {
          Column({ space: 12 }) { ForEach(this.labels, (_label: string, index: number) => { this.navigation(index) }) }
            .width(112).padding(12).height('100%').backgroundColor($r('app.color.bg_surface'))
        }
        Column() { this.content() }.layoutWeight(1).height('100%')
      }.width('100%').layoutWeight(1)
      if (this.availableWidth < 840 && !this.keyboardVisible) {
        Row() {
          ForEach(this.labels, (_label: string, index: number) => { Column() { this.navigation(index) }.layoutWeight(1) })
        }.width('100%').padding(8).backgroundColor($r('app.color.bg_surface'))
          .border({ width: { top: 1 }, color: $r('app.color.border_subtle') })
      }
    }.width('100%').height('100%').backgroundColor($r('app.color.bg_page'))
      .onAreaChange((_old: Area, area: Area) => { this.availableWidth = Number(area.width); })
  }
}
