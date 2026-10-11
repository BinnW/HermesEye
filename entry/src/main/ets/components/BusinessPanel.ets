import { common } from '@kit.AbilityKit';
import { BusinessState, BusinessEntity, BusinessMutation, BusinessConflict, BusinessPending,
  newBusinessState, assertBusinessIdentity } from '../core/BusinessSync';
import { Project, newId, dayKey, projectBrief } from '../core/Workspace';
import { BusinessClient } from '../services/BusinessClient';
import { BusinessCoordinator } from '../services/BusinessCoordinator';
import { BusinessRepository } from '../services/BusinessRepository';

@Component
export struct BusinessPanel {
  project: Project | undefined = undefined;
  @State root: string = '';
  @State token: string = '';
  @State allowHttp: boolean = false;
  @State status: string = '独立业务副本，不会自动上传旧计划、日历或历史对话。';
  @State busy: boolean = false;
  @State connected: boolean = false;
  @State localReady: boolean = false;
  @State title: string = '';
  @State prompt: string = '';
  @State needId: string = '';
  @State replica: BusinessState = newBusinessState({ protocolVersion: 1, serverId: 'unbound', workspaceId: 'unbound' }, 'unbound');
  private coordinator: BusinessCoordinator | undefined = undefined;

  aboutToAppear(): void {
    if (this.project) { this.needId = 'project-' + this.project.id; this.prompt = projectBrief(this.project); }
    this.loadOffline();
  }
  private async loadOffline(): Promise<void> {
    this.busy = true;
    try {
      const repository = new BusinessRepository();
      const state = await repository.existing(this.getUIContext().getHostContext() as common.UIAbilityContext);
      if (state) {
        this.replica = state; this.localReady = true;
        this.coordinator = new BusinessCoordinator(state, repository, new BusinessClient('https://unconfigured.invalid', ''));
        this.status = '已读取本机业务副本，可离线新增计划；同步或发送前请连接业务服务。';
      }
    } catch (error) { this.status = (error as Error).message; }
    finally { this.busy = false; }
  }
  private async connect(): Promise<void> {
    if (this.busy) { return; }
    this.busy = true;
    try {
      const client = new BusinessClient(this.root, this.token, this.allowHttp);
      const identity = await client.identity();
      const repository = new BusinessRepository();
      const context = this.getUIContext().getHostContext() as common.UIAbilityContext;
      const state = await repository.load(context, newBusinessState(identity, newId()));
      assertBusinessIdentity(state, identity);
      this.coordinator = new BusinessCoordinator(state, repository, client);
      this.replica = state; this.connected = true; this.localReady = true; this.token = '';
      this.status = '已绑定业务空间。点击同步才会上传待确认编辑。';
    } catch (error) { this.status = (error as Error).message; }
    finally { this.busy = false; }
  }
  private async act(action: (coordinator: BusinessCoordinator) => Promise<void>): Promise<void> {
    const coordinator = this.coordinator;
    if (!coordinator || this.busy) { return; }
    this.busy = true;
    try { await action(coordinator); this.status = '本次操作已保存；同步与执行状态以列表为准。'; }
    catch (error) { this.status = (error as Error).message; }
    finally { this.replica = coordinator.current(); this.busy = false; }
  }
  private async createPlan(coordinator: BusinessCoordinator): Promise<void> {
    if (!this.title.trim() || this.title.length > 200) { throw new Error('计划标题请输入 1–200 字'); }
    await coordinator.edit({ deviceId: this.replica.deviceId, mutationId: newId(), kind: 'plan', id: newId(),
      baseRevision: 0, deleted: false, payload: { title: this.title.trim(), date: dayKey(new Date()), status: 'todo', projectId: '' } });
    this.title = '';
  }
  private async exportProject(coordinator: BusinessCoordinator): Promise<void> {
    const project = this.project;
    if (!project) { throw new Error('项目已不存在'); }
    const confirmed = this.replica.entities.find((item: BusinessEntity) => item.kind === 'project' && item.id === project.id);
    await coordinator.edit({ deviceId: this.replica.deviceId, mutationId: newId(), kind: 'project', id: project.id,
      baseRevision: confirmed?.revision || 0, deleted: false, payload: { name: project.name, goal: project.goal,
        managedBy: project.managedBy, nextStep: project.nextStep, kind: project.kind || 'other',
        status: project.status || 'active', criteria: project.criteria || '', targetDate: project.targetDate || '',
        milestones: project.milestones || [], reviews: project.reviews || [] } });
  }
  private async deletePlan(coordinator: BusinessCoordinator, entity: BusinessEntity): Promise<void> {
    await coordinator.edit({ deviceId: this.replica.deviceId, mutationId: newId(), kind: entity.kind, id: entity.id,
      baseRevision: entity.revision, deleted: true, payload: {} });
  }
  private async send(coordinator: BusinessCoordinator): Promise<void> {
    if (!/^[a-zA-Z0-9_.-]{1,128}$/.test(this.needId) || !this.prompt.trim() || this.prompt.length > 4000) {
      throw new Error('填写稳定的会话标识（字母、数字、点或横线）及 1–4000 字消息');
    }
    await coordinator.send({ operationId: newId(), needId: this.needId, kind: 'chat', input: this.prompt.trim() });
    this.prompt = '';
  }
  build() {
    Column({ space: 12 }) {
      Text(this.project ? '项目 · 持久业务会话' : '业务服务 · 本地预览').fontSize(24).fontWeight(FontWeight.Bold)
      Text(this.status).fontSize(14)
      if (!this.connected) {
        TextInput({ placeholder: '独立业务服务根地址（不含 /v1）', text: this.root }).onChange((value: string) => { this.root = value; })
        TextInput({ placeholder: '本次业务服务 Token（不保存）', text: this.token }).type(InputType.Password)
          .onChange((value: string) => { this.token = value; })
        Row({ space: 8 }) {
          Toggle({ type: ToggleType.Switch, isOn: this.allowHttp }).onChange((value: boolean) => { this.allowHttp = value; })
          Text('允许私网 HTTP（仅本地调试）').fontSize(14)
        }
        Button('连接独立业务服务').enabled(!this.busy).onClick(() => { this.connect(); })
      }
      if (this.localReady) {
        Text('空间：' + this.replica.workspaceId + ' · 游标 ' + this.replica.cursor).fontSize(14)
        Button('同步业务副本').enabled(!this.busy).onClick(() => { this.act(async (c: BusinessCoordinator) => { await c.synchronize(); }); })
        Button('重建已确认副本（保留待确认编辑）').enabled(!this.busy)
          .onClick(() => { this.act(async (c: BusinessCoordinator) => { await c.synchronize(true); }); })
        if (this.project) {
          Text('项目目标、完成标准、里程碑与复盘由你确认后才上传；不会同步日历、凭据或旧会话。').fontSize(14)
          Button('确认将当前项目加入待同步列表').enabled(!this.busy && this.connected)
            .onClick(() => { this.act(async (c: BusinessCoordinator) => { await this.exportProject(c); }); })
        } else {
          TextInput({ placeholder: '新增今日计划', text: this.title }).onChange((value: string) => { this.title = value; })
          Button('保存到待同步列表').enabled(!this.busy).onClick(() => { this.act(async (c: BusinessCoordinator) => { await this.createPlan(c); }); })
        }
        ForEach(this.replica.entities.filter((item: BusinessEntity) => !item.deleted && (!this.project || (item.kind === 'project' && item.id === this.project.id))), (entity: BusinessEntity) => {
          Text(entity.kind + ' · ' + (entity.payload.title || entity.payload.name || entity.id) + ' · r' + entity.revision)
          if (entity.kind === 'plan') {
            Button('删除此计划').enabled(!this.busy).onClick(() => { this.act(async (c: BusinessCoordinator) => { await this.deletePlan(c, entity); }); })
          }
        }, (entity: BusinessEntity) => entity.kind + '/' + entity.id + '/' + entity.revision)
        ForEach(this.replica.outbox, (item: BusinessMutation) => {
          Text('待同步：' + (item.deleted ? '删除 ' : '') + (item.payload.title || item.id)).fontSize(14)
        }, (item: BusinessMutation) => item.mutationId)
        ForEach(this.replica.conflicts, (conflict: BusinessConflict) => {
          Text('编辑冲突：本机 ' + JSON.stringify(conflict.local.payload) + ' / 远端 ' + JSON.stringify(conflict.remote?.payload))
          Button('采用远端').enabled(!this.busy).onClick(() => {
            this.act(async (c: BusinessCoordinator) => { await c.resolve(conflict.local.mutationId, false, ''); });
          })
          Button('保留本机修改，重新提交').enabled(!this.busy).onClick(() => {
            this.act(async (c: BusinessCoordinator) => { await c.resolve(conflict.local.mutationId, true, newId()); });
          })
        }, (conflict: BusinessConflict) => conflict.local.mutationId)
        Text('持久会话 · 只发送本次输入，旧历史不会上传').fontSize(18)
        if (this.project) { Text('会话：' + this.needId + ' · 仅本次预览文本会分享给 Hermes') }
        else {
          TextInput({ placeholder: '会话标识，例如 study-harmony', text: this.needId }).onChange((value: string) => { this.needId = value; })
        }
        TextArea({ placeholder: '发送给 Hermes 的消息', text: this.prompt }).onChange((value: string) => { this.prompt = value; })
        Button('保存意图并发送').enabled(!this.busy && this.connected).onClick(() => { this.act(async (c: BusinessCoordinator) => { await this.send(c); }); })
        ForEach(this.replica.operations.filter((pending: BusinessPending) => !this.project || pending.intent.needId === this.needId), (pending: BusinessPending) => {
          Text(pending.intent.needId + ' · ' + (pending.operation?.state || '结果未知，请查询'))
          Text(pending.operation?.result.message || pending.operation?.result.output || '')
          Button('查询原操作').enabled(!this.busy).onClick(() => {
            this.act(async (c: BusinessCoordinator) => { await c.recover(pending.intent.operationId); });
          })
        }, (pending: BusinessPending) => pending.intent.operationId)
      }
    }.width('100%').alignItems(HorizontalAlign.Start)
      .enabled(!this.busy)
      .padding(8)
  }
}
