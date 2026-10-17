import { MessageContent } from '../components/MessageContent';
import { ReadingPanel } from '../components/ReadingPanel';
import { ReadingSnapshot } from '../core/Reading';
import { BusinessIdentity } from '../core/BusinessSync';
import { ProjectPanel } from '../components/ProjectPanel';
import { ProjectDraft, ProjectMilestone, projectKindLabel, projectStatusLabel, projectBrief } from '../core/Workspace';
import { BusinessPanel } from '../components/BusinessPanel';
import { showToast, applySystemAppearance, openExternalLink } from '../services/SystemPresentation';
import { reportPlatformFailure } from '../services/PlatformErrors';
import { common } from '@kit.AbilityKit';
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
import { ObjectCard } from '../components/ObjectCard';
import { OptionPicker, PickerOption } from '../components/OptionPicker';
import { FilterTabs } from '../components/FilterTabs';
import { DailyPlanCard } from '../components/DailyPlanCard';
import { WorkspaceNavigationItem } from '../components/WorkspaceNavigation';

interface ConversationContextDraft { calendar: boolean; device: boolean; needId: string; snapshot: Snapshot; }

@Entry
@Component
struct Index {
  @State data: Workspace = newWorkspace();
  @State ready: boolean = false;
  @State loaded: boolean = false;
  @State busy: boolean = false;
  @State sending: boolean = false;
  @State tab: number = 0;
  @State detail: string = '';
  @State solidSurfaces: boolean = false;
  @State feedback: string = '';
  @State feedbackFailed: boolean = false;
  @State undoPlanId: string = '';
  @State undoPlanBefore: WorkStatus = 'todo';
  @State undoSpace: string = '';
  @State undoFingerprint: string = '';
  @State connectionGroup: string = '';
  @State planOptions: boolean = false;
  @State recordOptions: boolean = false;
  @State newMessages: boolean = false;
  private followingMessages: boolean = true;
  @State route: string = '';
  @State availableWidth: number = 0;
  @State keyboardVisible: boolean = false;
  @State pendingPrompt: string = '';
  @State pendingKey: string = '';
  @State sendError: string = '';
  @State calendarEntries: CalendarEntry[] = [];
  @State calendarSelection: string[] = [];
  @State calendarDate: string = '';
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
  @State projectQuery: string = '';
  @State projectFilter: string = 'active';
  private projectPanelDrafts: Map<string, ProjectDraft> = new Map();
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
  private contextDrafts: Map<string, ConversationContextDraft> = new Map();
  private projectSections: Map<string, string> = new Map();
  private formDrafts: Map<string, string[]> = new Map();
  private projectDrafts: Map<string, string> = new Map();
  private labels: string[] = ['今日', '项目', '阅读', '我的'];
  private icons: Resource[] = [$r('app.media.nav_today'), $r('app.media.nav_projects'), $r('app.media.nav_reading'), $r('app.media.nav_profile')];
  private capabilities: IntegrationCapability[] = integrationCapabilities();

  aboutToAppear(): void {
    this.load();
    this.keyboardAvoidance.start(this.context(), (visible: boolean) => { this.keyboardVisible = visible; })
      .catch((error: Error) => { this.notice(error.message, true); });
  }
  aboutToDisappear(): void {
    try { this.keyboardAvoidance.stop(); } catch (error) { reportPlatformFailure('window.keyboardCleanup', error as Error); }
  }
  private context(): common.UIAbilityContext { return this.getUIContext().getHostContext() as common.UIAbilityContext; }
  private space(): Space { return activeSpace(this.data); }
  private routeKey(): string { return `${this.data.activeServer}|${this.route.startsWith('chat/') ? 'need' : this.tab}|${this.route}`; }
  private notice(message: string, failed: boolean = false): void {
    this.feedback = message; this.feedbackFailed = failed;
    if (message === this.lastToast && Date.now() - this.lastToastAt < 1500) { return; }
    if (showToast(this.getUIContext(), message, failed)) {
      this.lastToast = message; this.lastToastAt = Date.now();
    }
  }
  private remember(): void {
    if (this.route !== 'business' && !this.route.startsWith('project-business/')) {
      const offset = this.scroller.currentOffset();
      if (offset) { this.offsets.set(this.routeKey(), offset.yOffset); }
    }
    if (this.route.startsWith('chat/')) {
      this.drafts.set(this.routeKey(), this.chatDraft);
      this.contextDrafts.set(this.routeKey(), { calendar: this.shareCalendar, device: this.shareDevice, needId: this.shareNeed, snapshot: this.snapshot });
    }
  }
  private restore(): void {
    this.chatDraft = this.drafts.get(this.routeKey()) || '';
    const context = this.contextDrafts.get(this.routeKey());
    this.shareCalendar = context?.calendar || false; this.shareDevice = context?.device || false; this.shareNeed = context?.needId || '';
    if (context) { this.snapshot = context.snapshot; }
    this.newMessages = false; this.followingMessages = true;
    const offset = this.offsets.get(this.routeKey()) || 0;
    const key = this.routeKey();
    setTimeout(() => {
      if (this.routeKey() === key && this.route !== 'business' && !this.route.startsWith('project-business/')) {
        this.scroller.scrollTo({ xOffset: 0, yOffset: offset });
      }
    }, 0);
  }
  private go(route: string): void { this.detail = ''; this.remember(); this.history.push(this.route); this.route = route;
    if (route.startsWith('project/')) { this.projectNextStep = this.projectDrafts.get(this.data.activeServer + '/' + route) ?? this.selectedProject()?.nextStep ?? ''; }
    this.restore(); }
  private back(): void { this.detail = ''; this.remember(); this.route = this.history.pop() || ''; this.restore(); }
  private switchTab(index: number): void { this.detail = ''; this.remember(); this.tab = index; this.route = ''; this.history = []; this.restore(); }
  onBackPress(): boolean { if (this.detail) { this.detail = ''; return true; } if (this.route) { this.back(); return true; } return false; }
  private applyAppearance(index: number): void {
    applySystemAppearance(this.context(), index);
  }
  private async setAppearance(index: number): Promise<void> {
    const previous = this.data.appearance;
    try {
      this.applyAppearance(index);
      if (!await this.commit((next: Workspace) => { next.appearance = index; }, '显示偏好已保存')) {
        this.applyAppearance(previous);
      }
    } catch (error) { this.notice('显示模式未切换：' + (error as Error).message, true); }
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
      this.data = await this.repository.load(this.context()); this.solidSurfaces = this.data.solidSurfaces === true; this.ready = true; this.loaded = true;
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
    const previous = this.space().plans.find((plan: PlanItem) => plan.id === id);
    const before: WorkStatus = previous?.status || 'todo';
    const spaceKey = this.data.activeServer;
    if (await this.commit((_next: Workspace, space: Space) => {
      const item = space.plans.find((plan: PlanItem) => plan.id === id);
      if (!item) { throw new Error('计划不存在'); } item.status = status;
    }, status === 'todo' ? '已重新打开为待完成' : status === 'done' ? '已完成' : '已设为进行中')) {
      this.undoPlanId = id; this.undoPlanBefore = before; this.undoSpace = spaceKey;
      this.undoFingerprint = JSON.stringify(this.space().plans.find((plan: PlanItem) => plan.id === id));
    }
  }
  private async undoPlanStatus(): Promise<void> {
    if (!this.undoPlanId) { return; }
    if (await this.commit((_next: Workspace, space: Space) => {
      const item = space.plans.find((plan: PlanItem) => plan.id === this.undoPlanId);
      if (this.data.activeServer !== this.undoSpace || !item || JSON.stringify(item) !== this.undoFingerprint) {
        throw new Error('事项或空间已变化，无法撤销；请在详情核对当前状态');
      }
      item.status = this.undoPlanBefore;
    }, '已恢复变更前状态')) { this.undoPlanId = ''; }
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
      const originServer = this.data.activeServer;
      const prompt = this.chatDraft;
      const request = createRequest(config.model, need.messages.slice(-40), prompt, this.sharePreview());
      const token = await this.credentials.read(config.credentialRef);
      this.pendingKey = draftKey; this.pendingPrompt = prompt; this.sendError = '';
      this.sending = true;
      const answer = await this.client.chat(this.settings(config), token, request);
      this.sending = false;
      const next = copyWorkspace(this.data);
      const origin = next.spaces.find((space: Space) => space.serverKey === originServer);
      const target = origin?.needs.find((item: Need) => item.id === need.id);
      if (!target) { throw new Error('需求已不存在'); }
      target.messages.push(request.messages[request.messages.length - 1], { role: 'assistant', content: answer });
      try { await this.repository.save(next); }
      catch {
        this.data = next; this.ready = false; this.pendingPrompt = '';
        throw new Error('已收到回复但本地保存失败，回复仅保留在内存；请复制内容，不要重复发送');
      }
      this.data = next; this.pendingPrompt = '';
      if (this.routeKey() === draftKey) {
        if (this.followingMessages) { setTimeout(() => { this.scroller.scrollEdge(Edge.Bottom); }, 0); }
        else { this.newMessages = true; }
      }
      this.drafts.set(draftKey, '');
      if (this.routeKey() === draftKey) { this.chatDraft = ''; }
      if (this.routeKey() === draftKey) {
        this.shareCalendar = false; this.shareDevice = false; this.shareNeed = '';
      }
      this.contextDrafts.delete(draftKey);
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

  private projectTaskSummary(project: Project): string {
    const tasks = this.space().plans.filter((item: PlanItem) => item.projectId === project.id && !item.calendarSource);
    return `已完成 ${tasks.filter((item: PlanItem) => item.status === 'done').length} / ${tasks.length} 项本机任务（不含日历）`;
  }
  private visibleProjects(): Project[] {
    const query = this.projectQuery.trim().toLowerCase();
    return this.space().projects.filter((item: Project) =>
      (this.projectFilter === 'all' || (item.status || 'active') === this.projectFilter) &&
      (!query || (item.name + ' ' + item.goal).toLowerCase().includes(query)));
  }
  private discussProject(project: Project): void {
    this.needProject = project.id;
    this.needName = project.name.slice(0, 90) + ' · 目标推进';
    this.needDescription = projectBrief(project);
    this.go('new-need');
  }

  @Styles
  surface() {
    .padding($r('app.float.space_card_inner')).width('100%').borderRadius($r('app.float.radius_card'))
    .backgroundColor(this.solidSurfaces ? $r('app.color.bg_surface') : $r('app.color.glass_content'))
    .backgroundBlurStyle(this.solidSurfaces ? BlurStyle.NONE : BlurStyle.Thin)
    .margin({ bottom: $r('app.float.space_card_gap') })
  }
  @Styles
  field() {
    .width('100%').constraintSize({ minHeight: $r('app.float.touch_min') }).borderRadius($r('app.float.radius_field')).backgroundColor($r('app.color.bg_surface'))
      .border({ width: 1, color: $r('app.color.border_control') })
      .stateStyles({
        focused: {
          .border({ width: 2, color: $r('app.color.focus') })
        }
      })
  }
  @Builder
  body(text: string) { Text(text).fontSize($r('app.float.font_body')).lineHeight(24).fontColor($r('app.color.text_primary')).width('100%') }
  @Builder
  hint(text: string) { Text(text).fontSize($r('app.float.font_aux')).lineHeight(21).fontColor($r('app.color.text_secondary')).width('100%') }
  @Builder
  section(title: string) { Text(title).fontSize($r('app.float.font_section')).fontWeight(FontWeight.Medium).fontColor($r('app.color.text_primary')).margin({ top: $r('app.float.space_section_gap'), bottom: $r('app.float.space_card_gap') }) }
  @Builder
  action(label: string, action: () => void, primary: boolean = false) {
    WorkspaceAction({ label: label, action: action, primary: primary, active: this.ready && !this.busy }).margin({ top: 8, bottom: 4 })
  }
  @Builder
  link(label: string, action: () => void, actionId: string = '') {
    WorkspaceAction({ label: label, action: action, active: this.loaded, actionId: actionId }).margin({ top: 8, bottom: 4 })
  }
  @Builder
  input(label: string, value: string, change: (value: string) => void, placeholder: string = label) {
    this.hint(label)
    TextInput({ text: value, placeholder: placeholder }).id('input-' + label).field().fontSize($r('app.float.font_body'))
      .fontColor($r('app.color.text_primary')).placeholderColor($r('app.color.text_secondary')).enabled(!this.busy)
      .onChange(change).margin({ top: 4, bottom: 12 })
  }
  @Builder
  area(label: string, value: string, change: (value: string) => void) {
    this.hint(label)
    TextArea({ text: value, placeholder: label }).id('input-' + label).field()
      .constraintSize({ minHeight: 96, maxHeight: 160 }).maxLength(4000)
      .fontSize($r('app.float.font_body')).fontColor($r('app.color.text_primary')).placeholderColor($r('app.color.text_secondary'))
      .enabled(!this.busy).onChange(change).margin({ top: 4, bottom: 12 })
  }
  @Builder
  check(label: string, value: boolean, change: (value: boolean) => void, available: boolean = true) {
    Row({ space: $r('app.float.space_tight') }) {
      Checkbox({ name: label }).select(value).width($r('app.float.control_checkbox')).height($r('app.float.control_checkbox')).margin($r('app.float.space_card_gap'))
        .selectedColor($r('app.color.action_primary')).enabled(!this.busy && available).onChange(change).accessibilityText(label)
      Text(label).fontSize($r('app.float.font_body')).fontColor($r('app.color.text_primary')).layoutWeight(1)
    }.width('100%').constraintSize({ minHeight: $r('app.float.touch_min') })
  }
  @Builder
  projectPicker(value: string, change: (value: string) => void, idPrefix: string = '') {
    OptionPicker({ options: this.projectOptions(), selected: value, active: this.ready && !this.busy, idPrefix: idPrefix, pick: change })
  }
  private projectOptions(): PickerOption[] {
    const options: PickerOption[] = [{ key: '', label: '独立 / 未归入项目' }];
    this.space().projects.forEach((project: Project) => { options.push({ key: project.id, label: project.name }); });
    return options;
  }
  private contextSourceOptions(): PickerOption[] {
    const options: PickerOption[] = [{ key: '', label: '不引用其他会话' }];
    this.space().needs.filter((item: Need) => item.id !== this.selectedNeed()?.id)
      .forEach((source: Need) => { options.push({ key: source.id, label: this.owner(source) + ' / ' + source.name }); });
    return options;
  }
  private planFilterTabs(): PickerOption[] {
    return [{ key: 'all', label: '全部' }, { key: 'todo', label: '待完成' }, { key: 'doing', label: '进行中' }, { key: 'done', label: '已完成' }];
  }
  private planStatusOptions(): PickerOption[] {
    return [{ key: 'todo', label: '待完成' }, { key: 'doing', label: '进行中' }, { key: 'done', label: '已完成' }];
  }
  private appearanceOptions(): PickerOption[] {
    return [{ key: '0', label: '跟随系统' }, { key: '1', label: '浅色' }, { key: '2', label: '深色' }];
  }
  private projectFilterOptions(): PickerOption[] {
    return [
      { key: 'active', label: projectStatusLabel('active') },
      { key: 'paused', label: projectStatusLabel('paused') },
      { key: 'completed', label: projectStatusLabel('completed') },
      { key: 'archived', label: projectStatusLabel('archived') },
      { key: 'all', label: '全部' }
    ];
  }
  @Builder
  planCard(item: PlanItem) {
    DailyPlanCard({ item: this.space().plans.find((plan: PlanItem) => plan.id === item.id) || item, writable: this.ready && !this.busy,
      projectName: this.space().projects.find((project: Project) => project.id ===
        this.space().plans.find((plan: PlanItem) => plan.id === item.id)?.projectId)?.name || '',
      solid: this.solidSurfaces, open: (id: string) => { this.detail = 'plan/' + id; },
      changeStatus: (id: string, status: WorkStatus) => this.setPlan(id, status),
      edit: (id: string) => { this.editPlan(id); },
      discuss: (id: string) => {
        const plan = this.space().plans.find((value: PlanItem) => value.id === id);
        if (plan) { this.openLinked(plan.title, 'plan', id); }
      }
    })
  }
  @Builder
  projectCard(project: Project) {
    ObjectCard({ title: project.name, solid: this.solidSurfaces, actionText: '查看项目详情',
      lines: [project.goal, '下一步：' + (project.nextStep || '尚未填写'),
        projectStatusLabel(project.status) + ' · 阶段 ' + (project.milestones || []).filter((item: ProjectMilestone) => item.done).length + '/' + (project.milestones || []).length,
        this.projectTaskSummary(project)],
      open: () => { this.go('project/' + project.id); } })
  }
  @Builder
  bookCard(book: ReadingItem) {
    ObjectCard({ title: book.title, solid: this.solidSurfaces, actionText: '查看阅读详情',
      lines: ['阅读进度：' + (book.progress === null ? '尚未获取' : book.progress), '历史阅读资料 · 保留原始摘抄与总结',
        book.source + ' · ' + new Date(book.updatedAt).toLocaleString()],
      open: () => { this.go('book/' + book.id); } })
  }
  @Builder
  home() {
    Row() {
      Column({ space: 6 }) {
        Text('今日').fontSize($r('app.float.font_page_title')).fontWeight(FontWeight.Medium).fontColor($r('app.color.text_primary'))
        this.hint(new Date().toLocaleDateString())
      }.layoutWeight(1).alignItems(HorizontalAlign.Start)
      Button('＋').constraintSize({ minHeight: $r('app.float.touch_min'), minWidth: $r('app.float.touch_min') }).backgroundColor(Color.Transparent)
        .fontColor($r('app.color.action_primary')).accessibilityText('新增事项、记录或需求').onClick(() => { this.detail = 'new'; })
    }.width('100%').margin({ bottom: $r('app.float.space_card_gap') })
    Text('今日计划 ›').fontSize($r('app.float.font_section')).fontWeight(FontWeight.Medium).fontColor($r('app.color.text_primary')).constraintSize({ minHeight: $r('app.float.touch_min') })
      .onClick(() => { this.changePlanDate(dayKey(new Date())); this.go('plans'); })
    Text(`本机今日事务：完成 ${planCounts(this.space(), dayKey(new Date()))[0]} · 进行中 ${planCounts(this.space(), dayKey(new Date()))[1]} · 待完成 ${planCounts(this.space(), dayKey(new Date()))[2]}（不含日历事项）`).fontSize($r('app.float.font_aux')).lineHeight(21).fontColor($r('app.color.text_secondary'))
    ForEach(this.space().plans.filter((item: PlanItem) => item.date === dayKey(new Date())).slice(0, 3), (item: PlanItem) => { this.planCard(item) }, (item: PlanItem) => item.id)
    if (!this.space().plans.some((item: PlanItem) => item.date === dayKey(new Date()))) { this.hint('今天还没有事项，点击＋开始安排。') }
    this.link('记录进展与精力 ›', () => { this.go('record'); })
    this.section('项目进展')
    if (!this.space().projects.length) { this.hint('还没有项目，从一个目标开始。') }
    ForEach(this.space().projects.filter((item: Project) => !item.status || item.status === 'active').slice(0, 2),
      (project: Project) => { this.projectCard(project) }, (project: Project) => project.id)
    this.link('全部项目', () => { this.switchTab(1); })
    this.section('最近在读')
    if (!this.space().books.length) { this.hint('尚未获取阅读资料，微信读书 Skill 与业务同步待联调。') }
    ForEach(this.space().books.slice(0, 2), (book: ReadingItem) => { this.bookCard(book) }, (book: ReadingItem) => book.id)
    this.link('阅读概览 ›', () => { this.switchTab(2); }, 'home-reading')
  }
  @Builder
  projects() {
    Row() {
      Text('项目').fontSize($r('app.float.font_page_title')).fontWeight(FontWeight.Medium).fontColor($r('app.color.text_primary')).layoutWeight(1)
      Button('＋').id('project-create').constraintSize({ minHeight: $r('app.float.touch_min'), minWidth: $r('app.float.touch_min') }).backgroundColor(Color.Transparent)
        .fontColor($r('app.color.action_primary')).accessibilityText('新建项目').onClick(() => { this.go('new-project'); })
    }.width('100%').margin({ bottom: $r('app.float.space_card_gap') })
    Row({ space: $r('app.float.space_card_gap') }) {
      TextInput({ text: this.projectQuery, placeholder: $r('app.string.project_search') }).id('project-search')
        .constraintSize({ minHeight: $r('app.float.touch_min') }).fontSize($r('app.float.font_body')).fontColor($r('app.color.text_primary')).layoutWeight(2)
        .backgroundColor($r('app.color.bg_surface')).onChange((value: string) => { this.projectQuery = value; })
      Button((this.projectFilter === 'all' ? '全部' : projectStatusLabel(this.projectFilter)) + '⌄')
        .id('project-state-filter').layoutWeight(1).constraintSize({ minHeight: $r('app.float.touch_min') })
        .fontColor($r('app.color.text_primary')).backgroundColor($r('app.color.bg_surface'))
        .onClick(() => { this.detail = 'project-filter'; })
    }.width('100%').margin({ bottom: $r('app.float.space_card_gap') })
    if (!this.visibleProjects().length) {
      Text($r('app.string.project_empty_filter')).id('project-empty-filter').fontSize($r('app.float.font_aux')).fontColor($r('app.color.text_secondary'))
    }
    ForEach(this.visibleProjects(), (project: Project) => { this.projectCard(project) }, (project: Project) => project.id)
    ObjectCard({ title: '独立需求 ›', solid: this.solidSurfaces, actionText: '查看独立需求列表',
      lines: ['还没形成项目的想法，也有自己的会话'], open: () => { this.go('independent-needs'); } })
  }
  @Builder
  needCard(need: Need) {
    ObjectCard({ title: need.name, solid: this.solidSurfaces, actionText: '继续已有需求会话',
      lines: [this.owner(need) + ' · ' + new Date(need.createdAt).toLocaleString()],
      open: () => { this.go('chat/' + need.id); } })
  }
  @Builder
  projectDetail(project: Project) {
    ProjectPanel({ project: this.selectedProject(), writable: this.ready && !this.busy, server: this.data.activeServer,
      sections: this.projectSections, error: this.feedbackFailed ? this.feedback : '', drafts: this.projectPanelDrafts, solid: this.solidSurfaces,
      actionContent: () => { this.projectActions(project); },
      needsContent: () => { this.projectNeeds(project); },
      addAction: () => { this.planDate = dayKey(new Date()); this.newPlan(); this.planProject = project.id; },
      sync: () => { this.go('project-business/' + project.id); },
      save: (change: (space: Space) => void) => this.commit((_next: Workspace, space: Space) => { change(space); }),
      discuss: (item: Project) => { this.discussProject(item); }
    })
  }
  @Builder
  projectNeeds(project: Project) {
    this.section('需求会话')
    ForEach(this.space().needs.filter((need: Need) => need.ownerKind === 'project' && need.ownerId === project.id),
      (need: Need) => { this.needCard(need) }, (need: Need) => need.id)
  }
  @Builder
  projectActions(project: Project) {
    ForEach(this.space().plans.filter((item: PlanItem) => item.projectId === project.id && !item.calendarSource),
      (item: PlanItem) => { this.planCard(item) }, (item: PlanItem) => item.id)
    if (!this.space().plans.some((item: PlanItem) => item.projectId === project.id && !item.calendarSource)) { this.hint('尚无本机关联行动，可从＋添加。') }
  }
  @State projectNextStep: string = '';
  @Builder
  newProject() {
    ProjectPanel({ solid: this.solidSurfaces, error: this.feedbackFailed ? this.feedback : '', writable: this.ready && !this.busy, server: this.data.activeServer, drafts: this.projectPanelDrafts,
      save: (change: (space: Space) => void) => this.commit((_next: Workspace, space: Space) => { change(space); }),
      opened: (id: string) => { this.back(); this.go('project/' + id); }
    })
  }

  @Builder
  newNeed() {
    SectionHeading({ title: '发起需求', subtitle: '名称留空即为“漫无目的”，每次建立独立会话。' })
    this.input('需求名称（可选）', this.needName, (value: string) => { this.needName = value; })
    this.area('起始描述（进入会话后确认发送）', this.needDescription, (value: string) => { this.needDescription = value; })
    this.section('归属')
    this.projectPicker(this.needProject, (value: string) => { this.needProject = value; }, 'need-project-')
    this.action('建立需求会话', () => { this.addNeed(); }, true)
  }
  @Builder
  planEditor() {
    SectionHeading({ title: this.planEditId ? '编辑计划' : '添加计划', subtitle: '保存到本机；返回和保存失败均保留输入。' })
    this.input('计划日期 YYYY-MM-DD', this.planEditDate, (value: string) => { this.planEditDate = value; })
    if (this.space().plans.find((item: PlanItem) => item.id === this.planEditId)?.calendarSource) {
      this.hint('此事项来自手机日历，日期须与原计划一致；编辑仅修改本机副本。')
    }
    this.input('计划事项（1–200 字）', this.planTitle, (value: string) => { this.planTitle = value; }, '例如：阅读第 3 章并整理笔记')
    this.area('补充说明（可选）', this.planNote, (value: string) => { this.planNote = value; })
    this.action('项目与安排：' + (this.planProject ? '已归属项目' : '独立事项') + (this.planPriority === 'important' ? ' · 重要' : '') + (this.planMinutes ? ' · ' + this.planMinutes + ' 分钟' : ''), () => { this.planOptions = !this.planOptions; })
    if (this.planOptions) {
    this.check('重要事项', this.planPriority === 'important', (value: boolean) => { this.planPriority = value ? 'important' : 'normal'; })
    this.input('预计用时（可选，分钟）', this.planMinutes, (value: string) => { this.planMinutes = value; })
    this.section('所属项目')
    this.projectPicker(this.planProject, (value: string) => { this.planProject = value; }, 'plan-project-')
    }
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
    Text(this.planDate + ' ›').id('plan-date-selector').fontSize($r('app.float.font_section')).constraintSize({ minHeight: $r('app.float.touch_min') })
      .fontColor($r('app.color.action_primary')).onClick(() => { this.detail = 'date'; })
    WorkspaceAction({ label: '工具与来源 ···', action: () => { this.detail = 'plan-tools'; } }).id('plan-tools')
    if (!validDate(this.planDate)) {
      Text('请输入有效日期后查看计划。').fontColor($r('app.color.status_error')).fontSize($r('app.float.font_aux'))
    } else {
      Text(`事务：完成 ${planCounts(this.space(), this.planDate)[0]} · 进行中 ${planCounts(this.space(), this.planDate)[1]} · 待完成 ${planCounts(this.space(), this.planDate)[2]}`)
        .fontSize($r('app.float.font_body')).lineHeight(24).fontColor($r('app.color.text_primary'))
      Text(`已加入日历事项占用 ${calendarBusyMinutes(this.space(), this.planDate)} 分钟（重叠去重，全天单列）；不计入事务完成统计。`)
        .fontSize($r('app.float.font_aux')).lineHeight(21).fontColor($r('app.color.text_secondary'))
      this.section('当日事项')
      FilterTabs({ options: this.planFilterTabs(), selected: this.planFilter, active: this.ready && !this.busy, pick: (key: string) => { this.planFilter = key; } })
      if (!this.visiblePlans().length) {
        Text(this.space().plans.some((item: PlanItem) => item.date === this.planDate) ? '当前状态下没有事项，可切换到全部。' : '这一天还没有计划。添加一件想推进的事，或从下方建议逐项采纳。')
          .fontSize($r('app.float.font_body')).lineHeight(24).fontColor($r('app.color.text_secondary'))
      }
      ForEach(this.visiblePlans(), (item: PlanItem) => { this.planCard(item) }, (item: PlanItem) => item.id)
      this.action('添加事项', () => { this.newPlan(); }, true)
    }
  }
  @Builder
  calendarPicker() {
      this.section('日历安排 · 手机日历')
      Text(this.calendarDate === this.planDate ? `${this.calendarDate} · ${this.calendarEntries.length} 条日程，由你选择重要事项` : '尚未读取所选日期日历。').fontSize($r('app.float.font_aux')).lineHeight(21)
        .fontColor($r('app.color.text_secondary'))
      if (this.calendarError) { Text(this.calendarError).fontSize($r('app.float.font_aux')).lineHeight(21).fontColor($r('app.color.status_error')) }
      this.action(this.busy ? '正在处理…' : '授权并刷新所选日期日历', () => { this.loadCalendarDate(this.planDate); })
      if (this.calendarDate === this.planDate) {
        Text('采集于 ' + new Date(this.snapshot.capturedAt).toLocaleString() + ' · 本机快照，非日历实时同步').fontSize($r('app.float.font_aux')).lineHeight(21).fontColor($r('app.color.text_secondary'))
        ForEach(this.calendarEntries, (entry: CalendarEntry) => {
          Column({ space: 4 }) {
            this.check(entry.title, this.calendarSelection.includes(entry.key), (selected: boolean) => {
              this.calendarSelection = selected ? this.calendarSelection.concat(entry.key) : this.calendarSelection.filter((key: string) => key !== entry.key);
            }, !this.space().plans.some((plan: PlanItem) => plan.calendarSource?.key === entry.key))
            Text(entry.allDay ? '全天' : new Date(entry.start).toLocaleString() + ' — ' + new Date(entry.end).toLocaleString())
              .fontSize($r('app.float.font_aux')).lineHeight(21).fontColor($r('app.color.text_secondary'))
            if (this.space().plans.some((plan: PlanItem) => plan.calendarSource?.key === entry.key)) {
              Text('已加入计划 · 再次导入将跳过').fontSize($r('app.float.font_aux')).fontColor($r('app.color.status_success'))
            }
          }.surface()
        }, (entry: CalendarEntry) => entry.key)
        if (this.calendarSelection.length) {
          this.hint('所选日程将作为独立日历事项加入所选日期，不自动完成、不修改系统日历。')
          this.action('确认加入所选日程', () => { this.importCalendar(); })
        }
      }
  }
  @Builder
  suggestionPicker() {
      this.section('历史建议 · 本机规则')
      this.hint('回看所选日期之前 7 天未完成事务和记录中的新增待办。逐项采纳会新建待完成事项，原事项保留；相同来源同日不会重复采纳。')
      if (!planSuggestions(this.space(), this.planDate).length) {
        this.hint('暂无可采纳建议。记录中超过 200 字的待办请先在记录页拆分后手动添加。')
      }
      ForEach(planSuggestions(this.space(), this.planDate), (suggestion: PlanSuggestion) => {
        ObjectCard({ title: suggestion.title, solid: this.solidSurfaces, actionText: '查看来源与采纳依据',
          lines: ['查看来源与采纳依据 ›'], open: () => { this.detail = 'suggestion/' + suggestion.key; } })
      }, (suggestion: PlanSuggestion) => suggestion.key)
  }
  @Builder
  record() {
    SectionHeading({ title: '记录进展与精力', subtitle: '可以只写正文；发生区间与保存时间分开。' })
    this.area('完成了什么 / 快速记录', this.recordText, (value: string) => { this.recordText = value; })
    this.action('时间、精力与补记选项', () => { this.recordOptions = !this.recordOptions; })
    if (this.recordOptions) {
    this.input('开始时间（可选，如 2026-10-01T09:00）', this.recordStart, (value: string) => { this.recordStart = value; })
    this.input('结束时间（与开始同时填写）', this.recordEnd, (value: string) => { this.recordEnd = value; })
    this.input('未完成事项（可选）', this.recordUnfinished, (value: string) => { this.recordUnfinished = value; })
    this.input('精力自述（可选，量表待确认）', this.recordEnergy, (value: string) => { this.recordEnergy = value; })
    this.input('决策（可选）', this.recordDecision, (value: string) => { this.recordDecision = value; })
    this.input('新增待办（可选）', this.recordTodo, (value: string) => { this.recordTodo = value; })
    this.check('这是补记', this.backfilled, (value: boolean) => { this.backfilled = value; })
    }
    this.action('仅保存到本机收件箱', () => { this.saveRecord(); }, true)
    this.link('查看收件箱', () => { this.go('inbox'); })
  }
  @Builder
  inbox() {
    SectionHeading({ title: '本机收件箱', subtitle: '保存记录不要求立即对话；交给 Hermes 前建立需求。' })
    ForEach(this.space().records, (record: IntervalRecord) => {
      ObjectCard({ title: record.text, solid: this.solidSurfaces, actionText: '查看记录详情',
        lines: [new Date(record.createdAt).toLocaleString() + (record.backfilled ? ' · 补记' : '') + ' · 保存时间'],
        open: () => { this.detail = 'record/' + record.id; } })
    }, (record: IntervalRecord) => record.id)
    if (!this.space().records.length) { this.hint('还没有记录，写一句就好。') }
    this.link('记一笔', () => { this.go('record'); })
  }
  @Builder
  report() {
    SectionHeading({ title: '记录与日报', subtitle: '以下为原始记录的本机汇总；自动精力日报模板待确认。' })
    this.input('日期 YYYY-MM-DD', this.reportDate, (value: string) => { this.reportDate = value; })
    Text(dailyReport(this.space(), this.reportDate)).fontSize($r('app.float.font_body')).lineHeight(24).fontColor($r('app.color.text_primary')).copyOption(CopyOptions.InApp)
    this.link('查看来源记录', () => { this.go('inbox'); })
    this.link('参考汇总制定计划', () => { this.go('plans'); })
  }
  @Builder
  reading() {
    SectionHeading({ title: '阅读', subtitle: '授权采集笔记、周期整理与逐条疑问讨论，不评估理解程度。' })
    ReadingPanel({ initial: this.space().readingSnapshot, spaceKey: this.data.activeServer, serverId: this.space().readingServerId || '',
      workspaceId: this.space().readingWorkspaceId || '',
      cache: (snapshot: ReadingSnapshot, identity: BusinessIdentity, spaceKey: string) => this.commit((_next: Workspace, space: Space) => {
        if (spaceKey !== this.data.activeServer) { throw new Error('空间已切换，禁止把旧阅读请求写入新空间'); }
        if (space.readingServerId && (space.readingServerId !== identity.serverId || space.readingWorkspaceId !== identity.workspaceId)) {
          throw new Error('阅读服务身份变化，禁止覆盖原副本');
        }
        space.readingSnapshot = snapshot; space.readingServerId = identity.serverId; space.readingWorkspaceId = identity.workspaceId;
      }, '实际阅读结果已缓存到本机') })
    if (this.space().books.length) { this.section('历史阅读资料') }
    ForEach(this.space().books, (book: ReadingItem) => { this.bookCard(book) }, (book: ReadingItem) => book.id)
  }
  @Builder
  bookDetail(book: ReadingItem) {
    SectionHeading({ title: book.title, subtitle: book.source })
    this.hint('来源：' + book.source)
    this.section('原始摘抄与笔记')
    ForEach(book.excerpts, (text: string) => { this.body(text) })
    this.section('总结')
    ForEach(book.summaries, (text: string) => { this.body(text) })
    this.action('继续阅读需求会话', () => { this.openLinked(book.title, 'book', book.id); }, true)
  }
  @Builder
  chat(need: Need) {
    ForEach(this.selectedNeed()?.messages ?? [], (message: Message, index: number) => {
      Row() {
        if (message.role === 'user') { Blank().width('18%') }
        Column({ space: 6 }) {
          Text(message.role === 'user' ? '你' : 'Hermes · AI').fontSize($r('app.float.font_small')).fontColor($r('app.color.text_secondary'))
          MessageContent({ content: message.content, openLink: (url: string) => {
            openExternalLink(this.context(), url).catch((error: Error) => { this.notice(error.message, true); });
          } })
        }.alignItems(HorizontalAlign.Start).padding($r('app.float.space_card_inner')).layoutWeight(1)
          .borderRadius(message.role === 'user' ? { topLeft: 20, topRight: 20, bottomLeft: 20, bottomRight: 6 } : { topLeft: 20, topRight: 20, bottomLeft: 6, bottomRight: 20 })
          .backgroundColor(message.role === 'user' ? $r('app.color.selection_bg') : $r('app.color.bg_surface'))
        if (message.role !== 'user') { Blank().width('12%') }
      }.width('100%').margin({ bottom: $r('app.float.space_card_gap') })
    }, (_message: Message, index: number) => need.id + '-' + index)
    if (this.pendingKey === this.routeKey()) {
      if (this.pendingPrompt) {
        Row() {
          Blank().width('18%')
          Column({ space: 6 }) {
            this.hint(this.sending ? '你 · 等待回执' : '你 · 受理状态待确认')
            this.body(this.pendingPrompt)
          }.surface().layoutWeight(1).backgroundColor($r('app.color.selection_bg'))
        }.width('100%')
      }
      if (this.sending) { this.hint('Hermes 正在回复…') }
      else if (this.pendingPrompt) { this.hint('受理状态无法确认。兼容文本接口不提供原请求查询；请保留输入，不要重复发送。') }
      if (this.sendError) { Text(this.sendError).fontColor($r('app.color.status_error')).copyOption(CopyOptions.InApp) }
    }
    ForEach(this.space().runs.filter((run: AgentRun) => run.needId === need.id), (run: AgentRun) => { this.runCard(run) }, (run: AgentRun) => run.id)
  }
  @Builder
  chatComposer() {
    Column({ space: 6 }) {
      if (this.shareCalendar || this.shareDevice || this.shareNeed) {
        this.action('本次上下文 · ' + (Number(this.shareCalendar) + Number(this.shareDevice) + Number(!!this.shareNeed)) + ' 项 · 查看与移除', () => { this.detail = 'context'; })
      }
      if (this.newMessages) { this.action('查看新消息 ↓', () => { this.scroller.scrollEdge(Edge.Bottom); this.newMessages = false; }) }
      Row({ space: $r('app.float.space_tight') }) {
        Button('＋').id('chat-context').width($r('app.float.touch_min')).constraintSize({ minHeight: $r('app.float.touch_min') }).backgroundColor(Color.Transparent)
          .fontColor($r('app.color.action_primary')).accessibilityText('选择本次发送上下文').onClick(() => { this.detail = 'context'; })
        TextArea({ text: this.chatDraft, placeholder: '继续这个需求' }).id('input-继续这个需求').layoutWeight(1)
          .constraintSize({ minHeight: $r('app.float.touch_min'), maxHeight: 150 }).maxLength(4000).fontSize($r('app.float.font_body')).fontColor($r('app.color.text_primary'))
          .backgroundColor($r('app.color.bg_surface')).enabled(!this.busy).onChange((value: string) => { this.chatDraft = value; })
        Button(this.sending ? '停止' : '发送').id('chat-send').width(64).constraintSize({ minHeight: $r('app.float.touch_min') })
          .backgroundColor($r('app.color.action_primary')).fontColor($r('app.color.action_on_primary'))
          .enabled(this.sending || (this.ready && !this.busy && !!this.chatDraft.trim() && !(this.pendingKey === this.routeKey() && this.pendingPrompt)))
          .onClick(() => { if (this.sending) { this.client.stop(); } else { this.send(); } })
      }.width('100%')
    }.padding($r('app.float.space_card_gap')).width('100%').backgroundColor(this.solidSurfaces ? $r('app.color.bg_surface') : $r('app.color.glass_floating'))
      .backgroundBlurStyle(this.solidSurfaces ? BlurStyle.NONE : BlurStyle.Thin)
  }
  @Builder
  contextPicker() {
    this.section('本次上下文授权')
    this.check('分享今日日历快照', this.shareCalendar, (value: boolean) => { this.shareCalendar = value; })
    this.check('分享设备快照', this.shareDevice, (value: boolean) => { this.shareDevice = value; })
    this.action('读取快照', () => { this.refreshCalendar(); })
    this.hint('选择仅用于本次发送；来源和采集时间可在下方核对。')
    OptionPicker({ options: this.contextSourceOptions(), selected: this.shareNeed, idPrefix: 'context-need-', pick: (key: string) => { this.shareNeed = key; } })
    this.hint(this.preview())
    this.hint('分享给 Hermes 及模型服务，保存在该需求历史中；不授予执行或部署权限。')
    this.action('移除全部附加上下文', () => { this.shareCalendar = false; this.shareDevice = false; this.shareNeed = ''; })
    this.action('确认本次选择', () => { this.detail = ''; }, true)
  }
  @Builder
  runCard(run: AgentRun) {
    Column({ space: $r('app.float.space_tight') }) {
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
    this.projectPicker(this.moveProject, (value: string) => { this.moveProject = value; }, 'move-project-')
    this.action('保存名称与归属', () => { this.commit((_next: Workspace, space: Space) => {
      moveNeed(space, this.route.split('/')[1], this.rename, this.moveProject);
    }).then((saved: boolean) => { if (saved) { this.back(); } }); }, true)
  }
  @Builder
  profile() {
    SectionHeading({ title: '我的', subtitle: '个人事务的统一入口，连接你自己部署的 Hermes。' })
    Column({ space: $r('app.float.space_tight') }) {
      this.body(this.data.connection?.name || '尚未配置 Agent')
      this.hint(this.connectionStatus)
      this.hint(this.space().lastSyncAt === null ? '本机副本 · 尚未业务同步' : '最后同步：' + new Date(this.space().lastSyncAt as number).toLocaleString())
    }.alignItems(HorizontalAlign.Start).surface().onClick(() => { this.go('connection'); })
    this.action('独立业务服务（本地预览）', () => { this.go('business'); })
    this.action('查看本地迁移收件箱', () => {
      this.commit((next: Workspace) => { next.activeServer = 'local'; }, '已切换到本地空间，不自动上传历史记录').then((saved: boolean) => { if (saved) { this.go('inbox'); } });
    })
    if (this.data.connection && this.data.activeServer === 'local') {
      this.action('返回已配置的服务器空间', () => { this.commit((next: Workspace) => { next.activeServer = serverKey(next.connection as Connection); }); })
    }
    this.section('数据来源与授权')
    this.link('日历 / 健康 / 微信读书 / IMA', () => { this.go('integrations'); })
    this.section('知识空间')
    this.link('手工 / Agent 知识空间 ›', () => { this.go('vaults'); })
    this.section('提醒与报告')
    this.link('系统提醒与周期策略', () => { this.go('reminders'); })
    this.link('记录与日报', () => { this.go('report'); })
    this.link('显示模式与材质 ›', () => { this.go('appearance'); })
  }
  @Builder
  appearance() {
    SectionHeading({ title: '显示模式', subtitle: '即时预览并保存；失败保留原有效设置。' })
    this.check('减少透明度 · 实色卡片', this.solidSurfaces, (value: boolean) => {
      this.commit((next: Workspace) => { next.solidSurfaces = value; }, '材质偏好已保存').then((saved: boolean) => {
        if (saved) { this.solidSurfaces = value; }
      });
    })
    this.section('显示模式（保存到本机）')
    OptionPicker({ options: this.appearanceOptions(), selected: String(this.data.appearance), idPrefix: 'appearance-',
      pick: (key: string) => { this.setAppearance(Number(key)); } })
  }
  @Builder
  connection() {
    SectionHeading({ title: 'Agent 连接', subtitle: this.connectionStatus })
    this.action('地址 · ' + (this.host ? this.protocol + '://' + this.host + ':' + this.port : '未设置'), () => { this.connectionGroup = 'address'; this.detail = 'connection'; })
    this.action('凭据 · ' + (this.token ? '已填写（安全存储）' : '未填写'), () => { this.connectionGroup = 'secret'; this.detail = 'connection'; })
    this.action('高级配置 · ' + (this.name || '未命名'), () => { this.connectionGroup = 'advanced'; this.detail = 'connection'; })
    this.action('连接诊断', () => { this.testConnection(); })
    this.action('仅保存配置', () => { this.saveConnection(false); })
    this.action('保存并连接', () => { this.saveConnection(true); }, true)
    this.hint('替换地址使用独立空间。保留字段只更新本页草稿，最终保存才持久化。Token 不保存在普通草稿中。')
  }
  @Builder
  connectionFields() {
    if (this.connectionGroup === 'address') {
    this.input('IP / 域名（不含协议与端口）', this.host, (value: string) => { this.host = value; })
    this.check('HTTPS（关闭则为 HTTP）', this.protocol === 'https', (value: boolean) => { this.protocol = value ? 'https' : 'http'; })
    this.input('端口', this.port, (value: string) => { this.port = value; })
    } else if (this.connectionGroup === 'secret') {
    this.hint('Token · 安全保存，不进入普通配置')
    TextInput({ text: this.token, placeholder: 'Token' }).type(this.showToken ? InputType.Normal : InputType.Password).field()
      .fontColor($r('app.color.text_primary')).placeholderColor($r('app.color.text_secondary')).fontSize($r('app.float.font_body')).enabled(!this.busy)
      .onChange((value: string) => { this.token = value; })
    this.check('显示 Token', this.showToken, (value: boolean) => { this.showToken = value; })
    } else {
    this.input('连接名称', this.name, (value: string) => { this.name = value; })
    this.input('API 基础路径（可选）', this.basePath, (value: string) => { this.basePath = value; })
    this.input('文本模型', this.model, (value: string) => { this.model = value; })
    this.check('明确允许受信任私有网络 HTTP', this.allowHttp, (value: boolean) => { this.allowHttp = value; })
    this.hint('HTTP 不加密；仅支持内网、回环及 Tailscale 100.64/10 地址，需自行确认网络受信任。')
    this.check('下次打开时连接此 Agent（不重放任务）', this.autoConnect, (value: boolean) => { this.autoConnect = value; })
    }
    this.action('保留修改', () => { this.detail = ''; }, true)
  }
  @Builder
  integrations() {
    SectionHeading({ title: '数据来源与能力', subtitle: '读取、本次分享和周期工作流分别授权；不以一次分享视为永久许可。' })
    this.section('手机日历 / 设备快照')
    Text(this.snapshot.calendar || '尚未读取，不代表权限已拒绝').fontSize($r('app.float.font_aux')).lineHeight(21)
      .fontColor($r('app.color.text_secondary')).width('100%')
    if (this.snapshot.capturedAt) {
      Text('采集于 ' + new Date(this.snapshot.capturedAt).toLocaleString() + ' · 有效期 10 分钟').fontSize($r('app.float.font_aux')).lineHeight(21)
        .fontColor($r('app.color.text_secondary')).width('100%')
    }
    this.action('按需授权并刷新', () => { this.refreshCalendar(); })
    ForEach(this.capabilities, (item: IntegrationCapability) => {
      ObjectCard({ title: item.title, solid: this.solidSurfaces, actionText: '查看范围与授权说明',
        lines: [item.status], open: () => { this.detail = 'capability/' + item.id; } })
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
      Column({ space: $r('app.float.space_tight') }) {
        this.body(task.title); this.hint(task.time + (task.weekdays ? ' · 工作日' : ' · 每天') + ' · 已注册配置')
        this.action('取消提醒', () => { this.removeReminder(task); })
      }.alignItems(HorizontalAlign.Start).surface()
    }, (task: Task) => task.id)
  }
  @Builder
  detailContent() {
    Scroll() {
      Column({ space: $r('app.float.space_card_gap') }) {
        this.action('关闭 · 保留当前草稿', () => { this.detail = ''; })
        if (this.detail.startsWith('plan/')) {
          ForEach(this.space().plans.filter((item: PlanItem) => item.id === this.detail.slice(5)), (item: PlanItem) => {
            SectionHeading({ title: item.title, subtitle: item.date + ' · ' + (item.calendarSource ? '手机日历副本' : '本机事务') })
            this.body(item.note || '无补充说明')
            this.hint('项目：' + (this.space().projects.find((project: Project) => project.id === item.projectId)?.name || '独立事项'))
            this.hint((item.priority === 'important' ? '重要事项' : '普通事项') + (item.minutes ? ' · 预计 ' + item.minutes + ' 分钟' : ''))
            if (item.calendarSource) { this.hint(item.calendarSource.allDay ? '全天' : new Date(item.calendarSource.start).toLocaleString() + ' — ' + new Date(item.calendarSource.end).toLocaleString()) }
            if (item.suggestionReason) { this.hint('采纳依据：' + item.suggestionReason) }
            OptionPicker({ options: this.planStatusOptions(), selected: item.status, idPrefix: 'plan-status-', active: this.ready && !this.busy,
              pick: (key: string) => { this.setPlan(item.id, key as WorkStatus); } })
            this.action('继续该事项会话', () => { this.detail = ''; this.openLinked(item.title, 'plan', item.id); }, true)
            this.action('编辑 / 改期 / 移除', () => { this.detail = ''; this.editPlan(item.id); })
          }, (item: PlanItem) => item.id)
        } else if (this.detail.startsWith('record/')) {
          ForEach(this.space().records.filter((record: IntervalRecord) => record.id === this.detail.slice(7)), (record: IntervalRecord) => {
            this.body(record.text)
            this.hint(record.start && record.end ? new Date(record.start).toLocaleString() + ' — ' + new Date(record.end).toLocaleString() : '未填写发生区间')
            this.hint('精力：' + (record.energy || '未填写'))
            this.body('未完成：' + (record.unfinished || '未填写'))
            this.body('决策：' + (record.decision || '未填写'))
            this.body('新增待办：' + (record.nextTodo || '未填写'))
            this.action('建立需求后交给 Hermes', () => { this.needDescription = record.text; this.go('new-need'); }, true)
            if (record.nextTodo) { this.action('新增待办 · 先编辑确认', () => { this.planDate = dayKey(new Date()); this.newPlan(); this.planTitle = record.nextTodo; }) }
          }, (record: IntervalRecord) => record.id)
        } else if (this.detail.startsWith('suggestion/')) {
          this.action('返回历史建议', () => { this.detail = 'suggestions'; })
          ForEach(planSuggestions(this.space(), this.planDate).filter((suggestion: PlanSuggestion) => suggestion.key === this.detail.slice(11)), (suggestion: PlanSuggestion) => {
            this.body(suggestion.title); this.hint(suggestion.reason)
            this.action('采纳到 ' + this.planDate, () => {
              this.commit((_next: Workspace, space: Space) => { adoptPlanSuggestion(space, this.planDate, suggestion.key); }).then((saved: boolean) => { if (saved) { this.detail = 'suggestions'; } });
            }, true)
          }, (suggestion: PlanSuggestion) => suggestion.key)
        } else if (this.detail.startsWith('capability/')) {
          ForEach(this.capabilities.filter((item: IntegrationCapability) => item.id === this.detail.slice(11)), (item: IntegrationCapability) => {
            this.body(item.title); this.hint(item.status); this.body(item.requirement)
          }, (item: IntegrationCapability) => item.id)
        } else if (this.detail === 'new') {
          this.action('每日事项', () => { this.changePlanDate(dayKey(new Date())); this.newPlan(); })
          this.action('记录进展', () => { this.go('record'); })
          this.action('独立需求', () => { this.needProject = ''; this.go('new-need'); })
        } else if (this.detail === 'date') {
          this.input('查看日期 YYYY-MM-DD', this.planDate, (value: string) => { this.changePlanDate(value); })
          this.action('前一天', () => { this.shiftPlanDate(-1); })
          this.action('今天', () => { this.changePlanDate(dayKey(new Date())); })
          this.action('后一天', () => { this.shiftPlanDate(1); })
        } else if (this.detail === 'plan-tools') {
          this.action('手机日历', () => { this.detail = 'calendar'; })
          this.action('历史建议', () => { this.detail = 'suggestions'; })
          this.action('记录与日报', () => { this.reportDate = this.planDate; this.go('report'); })
          this.action('晚间提醒', () => { this.reminderTitle = '制定明日计划'; this.go('reminders'); })
        } else if (this.detail === 'calendar') { this.calendarPicker() }
        else if (this.detail === 'suggestions') { this.suggestionPicker() }
        else if (this.detail === 'context') { this.contextPicker() }
        else if (this.detail === 'connection') { this.connectionFields() }
        else if (this.detail === 'project-filter') {
          OptionPicker({ options: this.projectFilterOptions(), selected: this.projectFilter, idPrefix: 'project-filter-',
            pick: (key: string) => { this.projectFilter = key; this.detail = ''; } })
        } else if (this.detail === 'chat-more' && this.selectedNeed()) {
          this.body(this.selectedNeed()?.name || '')
          this.hint(this.connectionStatus)
          this.hint('兼容文本接口携带最近40条历史。超时无法确认受理，不会自动重放；停止等待不代表取消远端运行。')
          this.action('名称与归属', () => { const need = this.selectedNeed(); if (need) { this.rename = need.name; this.moveProject = need.ownerKind === 'project' ? need.ownerId : ''; this.go('move/' + need.id); } })
          this.action('连接设置', () => { this.go('connection'); })
        }
        if (this.feedbackFailed) { Text(this.feedback).fontSize($r('app.float.font_aux')).fontColor($r('app.color.status_error')) }
      }.padding($r('app.float.space_section_gap')).width('100%').alignItems(HorizontalAlign.Start)
    }.width('100%').height('100%')
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
        if (this.route && !this.route.startsWith('chat/')) { this.link('返回', () => { this.back(); }) }
        if (!this.ready) { this.hint('本机数据未就绪；若读取失败，请重新打开应用。未用空数据覆盖旧文件。') }
        if (this.loaded && this.route === 'new-project') { this.newProject() }
        else if (this.route.startsWith('project/') && this.selectedProject()) { this.projectDetail(this.selectedProject() as Project) }
        else if (this.route === 'independent-needs') {
          SectionHeading({ title: '独立需求', subtitle: '每个需求保留自己的身份与历史' })
          this.action('＋ 发起独立需求', () => { this.needProject = ''; this.go('new-need'); })
          ForEach(this.space().needs.filter((need: Need) => need.ownerKind === 'independent'), (need: Need) => { this.needCard(need) }, (need: Need) => need.id)
        }
        else if (this.route === 'new-need') { this.newNeed() }
        else if (this.route.startsWith('chat/') && this.selectedNeed()) { this.chat(this.selectedNeed() as Need) }
        else if (this.route.startsWith('move/')) { this.move() }
        else if (this.route === 'plans') { this.plans() }
        else if (this.route === 'plan-editor') { this.planEditor() }
        else if (this.route === 'record') { this.record() }
        else if (this.route === 'inbox') { this.inbox() }
        else if (this.route === 'report') { this.report() }
        else if (this.route === 'appearance') { this.appearance() }
        else if (this.route === 'vaults') {
          SectionHeading({ title: '知识空间', subtitle: '托管方式与写入授权分别核对' })
          Column({ space: $r('app.float.space_card_gap') }) { this.body('手工托管 Vault'); this.hint('学习、鸿蒙及设备实践；PARA：项目 / 领域 / 资源 / 归档。写入权限尚待核验。') }.surface()
          Column({ space: $r('app.float.space_card_gap') }) { this.body('Agent 托管 Vault'); this.hint('远端工程与实践；PARA 同上。托管不是自动执行或无限写入授权。Obsidian 插件同步尚待接入。') }.surface()
        }
        else if (this.route === 'connection') { this.connection() }
        else if (this.route === 'integrations') { this.integrations() }
        else if (this.route === 'reminders') { this.reminders() }
        else if (this.route.startsWith('book/') && this.selectedBook()) { this.bookDetail(this.selectedBook() as ReadingItem) }
        else if (this.loaded && this.tab === 0) { this.home() }
        else if (this.loaded && this.tab === 1) { this.projects() }
        else if (this.loaded && this.tab === 2) { this.reading() }
        else if (this.loaded) { this.profile() }
      }.width('100%').constraintSize({ maxWidth: 720 }).padding({ top: 16, left: this.availableWidth >= 600 ? 24 : 16, right: this.availableWidth >= 600 ? 24 : 16, bottom: this.route ? 24 : 132 + (this.feedback ? 96 : 0) + (this.undoPlanId ? 48 : 0) }).alignItems(HorizontalAlign.Start)
    }.id('workspace-scroll').width('100%').layoutWeight(1)
      .onScrollStop(() => { this.followingMessages = this.scroller.isAtEnd(); })
  }
  build() {
    Stack({ alignContent: Alignment.Bottom }) {
      Column() {
        if (this.route !== 'business' && !this.route.startsWith('project-business/')) {
        Row({ space: $r('app.float.space_tight') }) {
          if (this.route.startsWith('chat/')) {
            Button('返回').constraintSize({ minHeight: $r('app.float.touch_min') }).backgroundColor(Color.Transparent).fontColor($r('app.color.action_primary')).onClick(() => { this.back(); })
            Column({ space: 2 }) {
              Text(this.selectedNeed()?.name || '需求会话').fontSize($r('app.float.font_section')).maxLines(2).fontColor($r('app.color.text_primary'))
              Text(this.selectedNeed() ? this.owner(this.selectedNeed() as Need) : '').fontSize($r('app.float.font_small')).fontColor($r('app.color.text_secondary'))
            }.layoutWeight(1).alignItems(HorizontalAlign.Start)
            Button('···').constraintSize({ minHeight: $r('app.float.touch_min'), minWidth: $r('app.float.touch_min') }).backgroundColor(Color.Transparent).fontColor($r('app.color.action_primary'))
              .accessibilityText('会话信息与更多').onClick(() => { this.detail = 'chat-more'; })
          } else {
            Text('HermesEye').fontSize($r('app.float.font_section')).fontColor($r('app.color.action_primary')).layoutWeight(1)
            Button('Agent 状态', { type: ButtonType.Normal }).constraintSize({ minHeight: $r('app.float.touch_min') }).fontSize($r('app.float.font_aux'))
              .backgroundColor(Color.Transparent).fontColor($r('app.color.selection_text')).onClick(() => { this.switchTab(3); })
          }
        }.padding({ left: $r('app.float.space_page_edge'), right: $r('app.float.space_page_edge') }).width('100%')
        }
        Column() {
          if (this.route === 'business' || this.route.startsWith('project-business/')) {
            BusinessPanel({ project: this.route.startsWith('project-business/') ? this.space().projects.find((item: Project) => item.id === this.route.slice('project-business/'.length)) : undefined, back: () => { this.back(); } })
          } else { this.content() }
        }.layoutWeight(1).width('100%')
        if (this.feedback && (this.route || this.keyboardVisible)) {
          Text(this.feedback).fontSize($r('app.float.font_aux')).fontColor(this.feedbackFailed ? $r('app.color.status_error') : $r('app.color.text_secondary'))
            .padding(8).width('100%').maxLines(3)
          if (this.undoPlanId && this.undoSpace === this.data.activeServer) {
            Button('撤销状态变化').constraintSize({ minHeight: $r('app.float.touch_min') }).enabled(!this.busy).onClick(() => { this.undoPlanStatus(); })
          }
        }
        if (this.route.startsWith('chat/')) { this.chatComposer() }
      }.width('100%').height('100%')
      if (!this.route && !this.keyboardVisible && this.loaded) {
        Column({ space: $r('app.float.space_tight') }) {
          if (this.feedback) {
            Text(this.feedback).fontSize($r('app.float.font_aux')).fontColor(this.feedbackFailed ? $r('app.color.status_error') : $r('app.color.text_secondary'))
              .padding(8).backgroundColor($r('app.color.bg_surface')).borderRadius($r('app.float.radius_field')).maxLines(3)
            if (this.undoPlanId && this.undoSpace === this.data.activeServer) {
              Button('撤销状态变化').constraintSize({ minHeight: $r('app.float.touch_min') }).enabled(!this.busy).onClick(() => { this.undoPlanStatus(); })
            }
          }
          Row() {
            ForEach(this.labels, (_label: string, index: number) => { Column() { this.navigation(index) }.layoutWeight(1) })
          }.width('100%').padding($r('app.float.space_capsule_inner')).borderRadius($r('app.float.radius_capsule'))
            .backgroundColor(this.solidSurfaces ? $r('app.color.bg_surface') : $r('app.color.glass_floating'))
            .backgroundBlurStyle(this.solidSurfaces ? BlurStyle.NONE : BlurStyle.Thin)
            .border({ width: 1, color: $r('app.color.border_subtle') })
            .shadow({ radius: 28, offsetX: 0, offsetY: 8, color: $r('app.color.nav_shadow') })
        }.width(this.availableWidth > 40 ? this.availableWidth - 40 : '90%').constraintSize({ maxWidth: $r('app.float.nav_max_width') }).margin({ bottom: $r('app.float.nav_bottom_margin') })
      }
    }.width('100%').height('100%').backgroundColor($r('app.color.bg_page'))
      .onAreaChange((_old: Area, area: Area) => { this.availableWidth = Number(area.width); })
      .bindSheet(this.detail.length > 0, this.detailContent(), {
        height: this.detail === 'project-filter' || this.detail === 'new' ? SheetSize.MEDIUM : SheetSize.LARGE,
        preferType: this.availableWidth >= 600 ? SheetType.CENTER : SheetType.BOTTOM,
        showClose: true, backgroundColor: this.solidSurfaces ? $r('app.color.bg_elevated') : $r('app.color.glass_floating'),
        blurStyle: this.solidSurfaces ? BlurStyle.NONE : BlurStyle.Thin,
        onWillDismiss: (action: DismissSheetAction) => { this.detail = ''; this.showToken = false; action.dismiss(); },
        onDisappear: () => { this.showToken = false; }
      })
  }
}
