import { common } from '@kit.AbilityKit';
import { AppData, Note, Task, Message, Settings, Snapshot, initialData, cleanText, apiBase, contextText, createRequest } from '../core/Domain';
import { Repository } from '../services/Repository';
import { HermesClient } from '../services/HermesClient';
import { deviceSnapshot, readCalendar, publishReminder, cancelReminder } from '../services/NativeData';

@Entry
@Component
struct Index {
  @State tab: number = 0;
  @State data: AppData = initialData();
  @State ready: boolean = false;
  @State busy: boolean = false;
  @State feedback: string = '';
  @State connected: string = '尚未检测连接';
  @State draft: string = '';
  @State noteDraft: string = '';
  @State taskTitle: string = '';
  @State taskTime: string = '08:30';
  @State weekdays: boolean = false;
  @State baseUrl: string = '';
  @State model: string = 'hermes-agent';
  @State token: string = '';
  @State allowHttp: boolean = false;
  @State shareNotes: boolean = false;
  @State shareCalendar: boolean = false;
  @State shareDevice: boolean = false;
  @State snapshot: Snapshot = { calendar: '', device: '', capturedAt: 0 };
  private repository: Repository = new Repository();
  private client: HermesClient = new HermesClient();
  private labels: string[] = ['今日', '对话', '数据', '任务', '设置'];

  aboutToAppear(): void { this.load(); }
  private context(): common.UIAbilityContext { return this.getUIContext().getHostContext() as common.UIAbilityContext; }
  private error(error: Error): void { this.feedback = error.message || '操作失败，请检查系统权限后重试'; }

  private async load(): Promise<void> {
    try {
      this.data = await this.repository.load(this.context());
      this.baseUrl = this.data.settings.baseUrl;
      this.model = this.data.settings.model;
      this.allowHttp = this.data.settings.allowLocalHttp;
      this.ready = true;
    } catch { this.feedback = '本地数据读取失败，已停用写入以保护原数据。请重新打开应用。'; }
  }

  private nextData(notes: Note[], messages: Message[], tasks: Task[], settings: Settings): AppData {
    return { version: 1, notes: notes, messages: messages, tasks: tasks, settings: settings };
  }
  private async commit(next: AppData): Promise<void> { await this.repository.save(next); this.data = next; }

  private async addNote(): Promise<void> {
    if (!this.ready || this.busy) { return; }
    this.busy = true;
    try {
      if (this.data.notes.length >= 200) { throw new Error('已达到 200 条记录上限，请先整理已有记录'); }
      const note: Note = { id: `${Date.now()}`, text: cleanText(this.noteDraft), createdAt: Date.now() };
      await this.commit(this.nextData([note].concat(this.data.notes), this.data.messages, this.data.tasks, this.data.settings));
      this.noteDraft = ''; this.feedback = '已保存在本机';
    } catch (error) { this.error(error as Error); } finally { this.busy = false; }
  }
  private async deleteNote(id: string): Promise<void> {
    if (!this.ready || this.busy) { return; }
    this.busy = true;
    try {
      await this.commit(this.nextData(this.data.notes.filter((note: Note) => note.id !== id), this.data.messages, this.data.tasks, this.data.settings));
      this.feedback = '本地记录已删除；已分享的副本不受影响';
    } catch (error) { this.error(error as Error); } finally { this.busy = false; }
  }
  private preview(): string {
    try {
      return contextText(this.data.notes, this.snapshot,
        { notes: this.shareNotes, calendar: this.shareCalendar, device: this.shareDevice }, Date.now()) || '本次仅发送输入内容与已有会话历史';
    } catch (error) { return (error as Error).message; }
  }
  private async send(): Promise<void> {
    if (!this.ready || this.busy) { return; }
    this.busy = true; this.feedback = '正在等待 Hermes…';
    try {
      const context = contextText(this.data.notes, this.snapshot,
        { notes: this.shareNotes, calendar: this.shareCalendar, device: this.shareDevice }, Date.now());
      const request = createRequest(this.data.settings.model, this.data.messages, this.draft, context);
      const answer = await this.client.chat(this.data.settings, this.token, request);
      const next = this.nextData(this.data.notes, request.messages.concat([{ role: 'assistant', content: answer }]), this.data.tasks, this.data.settings);
      try { await this.commit(next); } catch {
        this.data = next; this.ready = false;
        throw new Error('Hermes 已回复但本地保存失败；回复仍可查看。请勿重复发送，重开前请保存内容');
      }
      this.draft = ''; this.shareNotes = false; this.shareCalendar = false; this.shareDevice = false;
      this.connected = '最近一次对话成功'; this.feedback = '收到 Hermes 回复';
    } catch (error) { this.error(error as Error); } finally { this.busy = false; }
  }
  private async clearChat(): Promise<void> {
    if (this.busy || !this.ready) { return; }
    this.busy = true;
    try {
      await this.commit(this.nextData(this.data.notes, [], this.data.tasks, this.data.settings));
      this.feedback = '本机会话已清空，服务器历史不会因此删除';
    } catch (error) { this.error(error as Error); } finally { this.busy = false; }
  }
  private async refreshNative(withCalendar: boolean): Promise<void> {
    if (this.busy) { return; }
    this.busy = true; this.snapshot = { calendar: '', device: '', capturedAt: 0 };
    this.shareCalendar = false; this.shareDevice = false;
    try {
      const device = deviceSnapshot();
      const calendar = withCalendar ? await readCalendar(this.context()) : '';
      this.snapshot = { device: device, calendar: calendar, capturedAt: Date.now() };
      this.feedback = '已读取到本机，发送前仍需在对话页选择';
    } catch (error) { this.error(error as Error); } finally { this.busy = false; }
  }
  private async addTask(): Promise<void> {
    if (!this.ready || this.busy) { return; }
    this.busy = true;
    let registered = -1;
    try {
      if (this.data.tasks.length >= 20) { throw new Error('首版最多保留 20 个提醒'); }
      const title = cleanText(this.taskTitle, 100);
      const time = this.taskTime;
      const weekdays = this.weekdays;
      registered = await publishReminder(this.context(), title, time, weekdays);
      const task: Task = { id: `${Date.now()}`, title: title, time: time,
        weekdays: weekdays, reminderId: registered };
      await this.commit(this.nextData(this.data.notes, this.data.messages, this.data.tasks.concat([task]), this.data.settings));
      this.taskTitle = ''; this.feedback = '系统提醒已注册；此提醒不会自动执行 Hermes';
    } catch (error) {
      this.error(error as Error);
      if (registered >= 0) {
        try { await cancelReminder(registered); } catch { this.feedback = `保存失败且提醒未能撤销，系统提醒 ID：${registered}，请在系统中检查`; }
      }
    } finally { this.busy = false; }
  }
  private async removeTask(task: Task): Promise<void> {
    if (!this.ready || this.busy) { return; }
    this.busy = true;
    try {
      await cancelReminder(task.reminderId);
      await this.commit(this.nextData(this.data.notes, this.data.messages,
        this.data.tasks.filter((item: Task) => item.id !== task.id), this.data.settings));
      this.feedback = '系统提醒已取消';
    } catch { this.feedback = '取消或保存失败，请检查系统提醒状态；本地条目暂时保留'; }
    finally { this.busy = false; }
  }
  private async saveSettings(check: boolean): Promise<void> {
    if (!this.ready || this.busy) { return; }
    this.busy = true; this.connected = '尚未检测连接';
    try {
      apiBase(this.baseUrl, this.allowHttp);
      const settings: Settings = { baseUrl: this.baseUrl.trim(), model: cleanText(this.model, 100), allowLocalHttp: this.allowHttp };
      await this.commit(this.nextData(this.data.notes, this.data.messages, this.data.tasks, settings));
      this.feedback = '连接设置已保存；Token 仅本次运行有效';
      if (check) {
        await this.client.check(settings, this.token);
        this.connected = '接口与认证检测通过'; this.feedback = '连接成功，可以开始对话';
      }
    } catch (error) { this.error(error as Error); } finally { this.busy = false; }
  }

  @Builder
  heading(title: string, subtitle: string) {
    Column({ space: 8 }) {
      Text(title).fontSize(28).fontWeight(FontWeight.Bold).fontColor('#202B26')
      Text(subtitle).fontSize(14).fontColor('#66736A').lineHeight(22)
    }.alignItems(HorizontalAlign.Start).width('100%').margin({ bottom: 20 })
  }
  @Builder
  primary(label: string, action: () => void) {
    Button(label).width('100%').height(48).backgroundColor('#244D40').fontColor('#FFFFFF')
      .enabled(this.ready && !this.busy).onClick(action)
  }
  @Builder
  home() {
    this.heading('今天，把注意力留给生活。', new Date().toLocaleDateString() + '  /  你的个人空间')
    Column({ space: 16 }) {
      Text('HERMES · PERSONAL ASSISTANT').fontSize(11).fontColor('#C7DCCB').letterSpacing(2)
      Text('你的秘书，\n随时待命。').fontSize(32).fontWeight(FontWeight.Medium).fontColor(Color.White)
      Text('把想法、日程与行动放在一起。\n从一段对话，开始整理今天。').fontSize(15).fontColor('#E0EADF').lineHeight(25)
      Button('与秘书对话  →').backgroundColor('#E5ECE3').fontColor('#244D40').height(46).onClick(() => { this.tab = 1; })
    }.alignItems(HorizontalAlign.Start).padding(24).width('100%').backgroundColor('#244D40').borderRadius(24)
    Row({ space: 12 }) {
      Column({ space: 8 }) {
        Text(`${this.data.notes.length}`).fontSize(30).fontColor('#244D40')
        Text('个人记录').fontSize(14).fontColor('#66736A')
      }.padding(20).layoutWeight(1).backgroundColor(Color.White).borderRadius(20).onClick(() => { this.tab = 2; })
      Column({ space: 8 }) {
        Text(`${this.data.tasks.length}`).fontSize(30).fontColor('#244D40')
        Text('提醒任务').fontSize(14).fontColor('#66736A')
      }.padding(20).layoutWeight(1).backgroundColor(Color.White).borderRadius(20).onClick(() => { this.tab = 3; })
    }.margin({ top: 16, bottom: 16 })
    Column({ space: 10 }) {
      Text('连接自己的 Hermes').fontSize(18).fontWeight(FontWeight.Medium)
      Text(this.connected).fontSize(14).fontColor('#66736A')
      Button('管理连接').backgroundColor('#E5ECE3').fontColor('#244D40').onClick(() => { this.tab = 4; })
    }.alignItems(HorizontalAlign.Start).width('100%').padding(20).backgroundColor(Color.White).borderRadius(20)
    Text('最近记录').fontSize(18).fontWeight(FontWeight.Medium).margin({ top: 24, bottom: 12 })
    Text(this.data.notes.length ? this.data.notes[0].text : '还没有记录。留下一件今天值得记住的事。')
      .fontSize(15).fontColor('#66736A').lineHeight(24).width('100%').padding(20).backgroundColor(Color.White).borderRadius(20)
  }
  @Builder
  chat() {
    this.heading('与秘书对话', '直达你自己的 Hermes，让上下文跟随问题。')
    Column({ space: 10 }) {
      Text('本次分享的上下文').fontSize(17).fontWeight(FontWeight.Medium)
      Row() {
        Checkbox({ name: 'notes' }).select(this.shareNotes).onChange((value: boolean) => { this.shareNotes = value; })
        Text('记录').fontSize(14)
        Checkbox({ name: 'calendar' }).select(this.shareCalendar).onChange((value: boolean) => { this.shareCalendar = value; })
        Text('日历').fontSize(14)
        Checkbox({ name: 'device' }).select(this.shareDevice).onChange((value: boolean) => { this.shareDevice = value; })
        Text('设备').fontSize(14)
      }.width('100%')
      Text(this.preview()).fontSize(13).fontColor('#66736A').lineHeight(20).copyOption(CopyOptions.InApp)
      Text('发送内容会交给 Hermes 及其模型服务。历史中已分享的数据会随多轮对话继续发送。').fontSize(12).fontColor('#66736A')
    }.alignItems(HorizontalAlign.Start).padding(18).width('100%').backgroundColor('#E5ECE3').borderRadius(20)
    if (!this.data.messages.length) {
      Text('从一句话开始\n例如：帮我整理今天的安排。').fontSize(18).fontColor('#66736A').lineHeight(30).padding(28)
    }
    ForEach(this.data.messages, (message: Message, index: number) => {
      Column({ space: 8 }) {
        Text(message.role === 'user' ? '你' : 'HERMES').fontSize(12).fontColor('#66736A')
        Text(message.content).fontSize(16).lineHeight(25).copyOption(CopyOptions.InApp)
      }.alignItems(HorizontalAlign.Start).width('100%').padding(18).margin({ top: 12 })
        .backgroundColor(message.role === 'user' ? '#E5ECE3' : '#FFFFFF').borderRadius(20)
    }, (_message: Message, index: number) => `${index}`)
    TextArea({ placeholder: '有什么想交给秘书？', text: this.draft }).height(110).maxLength(4000)
      .onChange((value: string) => { this.draft = value; }).margin({ top: 20, bottom: 12 }).enabled(!this.busy)
    this.primary(this.busy ? '处理中…' : '发送给 Hermes', () => { this.send(); })
    Button('清空本机会话').fontColor('#66736A').backgroundColor(Color.Transparent).margin({ top: 8 })
      .enabled(!this.busy && this.ready).onClick(() => {
        this.getUIContext().showAlertDialog({ title: '清空本机会话？', message: '服务器上的已发送内容不会被删除。',
          primaryButton: { value: '保留', action: () => {} }, secondaryButton: { value: '清空', action: () => { this.clearChat(); } } });
      })
  }
  @Builder
  records() {
    this.heading('你的数据，由你选择。', '先在本机整理，再决定哪些内容交给秘书。')
    Text('记录一件事').fontSize(18).fontWeight(FontWeight.Medium).margin({ bottom: 12 })
    TextArea({ placeholder: '想法、偏好、生活片段…', text: this.noteDraft }).height(110).maxLength(4000)
      .onChange((value: string) => { this.noteDraft = value; }).margin({ bottom: 12 })
    this.primary('保存到个人记录', () => { this.addNote(); })
    Column({ space: 12 }) {
      Text('系统数据').fontSize(18).fontWeight(FontWeight.Medium)
      Text('读取当天日历与电量，快照 10 分钟内可用于对话。不会自动上传。').fontSize(14).fontColor('#66736A').lineHeight(22)
      Button('读取设备状态').onClick(() => { this.refreshNative(false); }).enabled(!this.busy).backgroundColor('#E5ECE3').fontColor('#244D40')
      Button('授权读取今日日历').onClick(() => { this.refreshNative(true); }).enabled(!this.busy).backgroundColor('#E5ECE3').fontColor('#244D40')
      Text(this.snapshot.device || '尚未读取设备状态').fontSize(14).fontColor('#66736A')
      Text(this.snapshot.calendar || '尚未读取日历').fontSize(14).fontColor('#66736A').lineHeight(22)
      if (this.snapshot.capturedAt > 0) { Text('采集于 ' + new Date(this.snapshot.capturedAt).toLocaleTimeString()).fontSize(12).fontColor('#66736A') }
    }.alignItems(HorizontalAlign.Start).padding(20).width('100%').margin({ top: 20, bottom: 20 }).backgroundColor(Color.White).borderRadius(20)
    Text(`个人记录 · ${this.data.notes.length}`).fontSize(18).fontWeight(FontWeight.Medium)
    ForEach(this.data.notes, (note: Note) => {
      Column({ space: 10 }) {
        Text(new Date(note.createdAt).toLocaleString()).fontSize(12).fontColor('#66736A')
        Text(note.text).fontSize(16).lineHeight(24).copyOption(CopyOptions.InApp)
        Button('删除记录').fontColor('#AD3B32').backgroundColor(Color.Transparent).enabled(!this.busy).onClick(() => {
          this.getUIContext().showAlertDialog({ title: '删除这条记录？', message: '删除后无法恢复。已分享的副本不会撤回。',
            primaryButton: { value: '保留', action: () => {} }, secondaryButton: { value: '删除', action: () => { this.deleteNote(note.id); } } });
        })
      }.alignItems(HorizontalAlign.Start).width('100%').padding(18).backgroundColor(Color.White).borderRadius(20).margin({ top: 12 })
    }, (note: Note) => note.id)
  }
  @Builder
  tasks() {
    this.heading('把行动，留给合适的时间。', '系统定期提醒。需要执行时，带着任务回到秘书。')
    Column({ space: 12 }) {
      TextInput({ placeholder: '例如：整理每日计划', text: this.taskTitle }).maxLength(100).onChange((value: string) => { this.taskTitle = value; })
      TextInput({ placeholder: '提醒时间 HH:mm', text: this.taskTime }).maxLength(5).onChange((value: string) => { this.taskTime = value; })
      Row() {
        Checkbox({ name: 'weekdays' }).select(this.weekdays).onChange((value: boolean) => { this.weekdays = value; })
        Text(this.weekdays ? '仅工作日（周一至周五）' : '每天提醒').fontSize(15)
      }
      this.primary('创建系统提醒', () => { this.addTask(); })
      Text('按设备本地时间提醒。首版尚未接入服务端定期执行，提醒不会自动运行智能体。').fontSize(13).fontColor('#66736A').lineHeight(21)
    }.padding(18).backgroundColor(Color.White).borderRadius(20).width('100%')
    ForEach(this.data.tasks, (task: Task) => {
      Column({ space: 10 }) {
        Text(task.time).fontSize(30).fontColor('#244D40')
        Text(task.title).fontSize(18).fontWeight(FontWeight.Medium)
        Text(task.weekdays ? '周一至周五 · 系统提醒已注册' : '每天 · 系统提醒已注册').fontSize(13).fontColor('#66736A')
        Row({ space: 12 }) {
          Button('交给秘书').backgroundColor('#E5ECE3').fontColor('#244D40').onClick(() => { this.draft = task.title; this.tab = 1; })
          Button('取消提醒').backgroundColor(Color.Transparent).fontColor('#AD3B32').enabled(!this.busy).onClick(() => { this.removeTask(task); })
        }
      }.alignItems(HorizontalAlign.Start).padding(20).width('100%').backgroundColor(Color.White).borderRadius(20).margin({ top: 16 })
    }, (task: Task) => task.id)
  }
  @Builder
  settings() {
    this.heading('连接你的私人秘书', '使用 Hermes API 地址，凭据只在自己的设备填写。')
    Column({ space: 14 }) {
      Text('服务地址').fontSize(15)
      TextInput({ placeholder: 'https://hermes.example.com/v1', text: this.baseUrl }).onChange((value: string) => { this.baseUrl = value; })
      Text('模型名称').fontSize(15)
      TextInput({ placeholder: 'hermes-agent', text: this.model }).onChange((value: string) => { this.model = value; })
      Text('Token · 仅本次运行有效').fontSize(15)
      TextInput({ placeholder: '输入 API Token', text: this.token }).type(InputType.Password).onChange((value: string) => { this.token = value; this.connected = '尚未检测连接'; })
      Row() {
        Checkbox({ name: 'http' }).select(this.allowHttp).onChange((value: boolean) => { this.allowHttp = value; })
        Text('允许局域网 HTTP 调试').fontSize(14)
      }
      Text('HTTP 不加密，只支持明确的内网 IP。手机上的 localhost 指向手机自身。').fontSize(12).fontColor('#66736A')
      this.primary('保存并检测连接', () => { this.saveSettings(true); })
      Button('仅保存地址与模型').width('100%').height(44).backgroundColor('#E5ECE3').fontColor('#244D40')
        .enabled(this.ready && !this.busy).onClick(() => { this.saveSettings(false); })
      Text(this.connected).fontSize(14).fontColor('#244D40')
    }.alignItems(HorizontalAlign.Start).padding(20).backgroundColor(Color.White).borderRadius(20).width('100%')
    Text('关于你的数据').fontSize(18).fontWeight(FontWeight.Medium).margin({ top: 24, bottom: 12 })
    Text('记录与会话保存在应用沙箱。Token 不写入普通存储，重启需重新填写。系统数据仅在主动读取时获取，分享需在发送前选择。\n\n这是 v0.1 开发预览，需要真实 Hermes 联调与真机验收后才能正式发布。')
      .fontSize(14).fontColor('#66736A').lineHeight(24)
  }
  build() {
    Column() {
      Row() {
        Text('HERMES EYE').fontSize(13).fontWeight(FontWeight.Bold).letterSpacing(2).fontColor('#244D40')
        Blank()
        Text('私人空间').fontSize(12).fontColor('#66736A')
      }.padding({ left: 20, right: 20, top: 16, bottom: 16 }).width('100%')
      if (this.feedback) { Text(this.feedback).fontSize(13).fontColor('#244D40').width('100%').padding(12).backgroundColor('#E5ECE3') }
      Scroll() {
        Column() {
          if (this.tab === 0) { this.home() }
          else if (this.tab === 1) { this.chat() }
          else if (this.tab === 2) { this.records() }
          else if (this.tab === 3) { this.tasks() }
          else { this.settings() }
        }.alignItems(HorizontalAlign.Start).width('100%').constraintSize({ maxWidth: 720 }).padding(20)
      }.layoutWeight(1).width('100%').align(Alignment.Top)
      Row() {
        ForEach(this.labels, (label: string, index: number) => {
          Button(label).layoutWeight(1).height(48).fontSize(14).fontWeight(this.tab === index ? FontWeight.Bold : FontWeight.Normal)
            .fontColor(this.tab === index ? '#244D40' : '#66736A').backgroundColor(this.tab === index ? '#E5ECE3' : '#FFFFFF')
            .borderRadius(12).onClick(() => { this.tab = index; })
        }, (label: string) => label)
      }.padding(8).width('100%').backgroundColor(Color.White)
    }.width('100%').height('100%').backgroundColor('#F4F5F0')
  }
}
