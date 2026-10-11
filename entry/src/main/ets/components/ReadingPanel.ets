import { BusinessClient } from '../services/BusinessClient';
import { BusinessIdentity, BusinessOperation } from '../core/BusinessSync';
import { ReadingSnapshot, ReadingPolicy, ReadingBook, ReadingEntry, ReadingQuestion, ReadingCycle, ReadingCollection, validateReadingSnapshot } from '../core/Reading';
import { newId } from '../core/Workspace';

@Component
export struct ReadingPanel {
  initial: ReadingSnapshot | undefined = undefined;
  spaceKey: string = '';
  serverId: string = '';
  workspaceId: string = '';
  cache: (snapshot: ReadingSnapshot, identity: BusinessIdentity, spaceKey: string) => Promise<boolean> = async () => false;
  @State root: string = '';
  @State token: string = '';
  @State allowHttp: boolean = false;
  @State busy: boolean = false;
  @State connected: boolean = false;
  @State message: string = '';
  @State books: ReadingBook[] = [];
  @State collections: ReadingCollection[] = [];
  @State bookIds: string = '';
  @State interval: string = '24';
  @State timezone: string = 'Asia/Shanghai';
  @State scheduleEnabled: boolean = false;
  @State consent: boolean = false;
  @State selectedBook: string = '';
  @State selectedEntry: string = '';
  @State entryLimit: number = 20;
  @State questionLimit: number = 20;
  @State questionText: string = '';
  @State quote: string = '';
  @State nextAt: number = 0;
  @State sourceConfigured: boolean = false;
  private client: BusinessClient | undefined = undefined;
  private identity: BusinessIdentity | undefined = undefined;

  aboutToAppear(): void {
    if (this.initial) { this.show(this.initial); }
  }
  private show(snapshot: ReadingSnapshot): void {
    validateReadingSnapshot(snapshot);
    this.collections = snapshot.collections || [];
    this.books = snapshot.books; this.bookIds = snapshot.policy.bookIds.join(',');
    this.interval = String(snapshot.policy.intervalHours); this.timezone = snapshot.policy.timezone;
    this.scheduleEnabled = snapshot.policy.enabled; this.consent = snapshot.policy.consent;
    this.nextAt = snapshot.policy.nextAt || 0; this.sourceConfigured = snapshot.sourceConfigured;
  }
  private async refresh(): Promise<void> {
    if (!this.client || !this.identity) { throw new Error('请先连接独立业务服务'); }
    const snapshot = validateReadingSnapshot(await this.client.reading());
    if (!await this.cache(snapshot, this.identity, this.spaceKey)) { throw new Error('阅读结果本机保存失败，请重新读取，不要重复发送'); }
    this.show(snapshot);
  }
  private async connect(): Promise<void> {
    if (this.busy) { return; }
    this.busy = true;
    try {
      const client = new BusinessClient(this.root, this.token, this.allowHttp);
      const identity = await client.identity();
      if (identity.protocolVersion !== 1 || !identity.serverId || !identity.workspaceId ||
        (this.serverId && (identity.serverId !== this.serverId || identity.workspaceId !== this.workspaceId))) {
        throw new Error('阅读服务身份与本机副本不同，禁止合并');
      }
      this.client = client; this.identity = identity;
      await this.refresh(); this.connected = true; this.token = '';
      this.message = '已读取业务服务的阅读副本。采集与整理需配置范围并明确授权。';
    } catch (error) { this.message = (error as Error).message; }
    finally { this.busy = false; }
  }
  private async act(action: (client: BusinessClient) => Promise<void>): Promise<void> {
    if (!this.client || this.busy) { return; }
    this.busy = true;
    try { await action(this.client); await this.refresh(); this.message = '已读取并保存实际结果。未知操作请查询，不要重发。'; }
    catch (error) { this.message = (error as Error).message; }
    finally { this.busy = false; }
  }
  private async savePolicy(client: BusinessClient): Promise<void> {
    const policy: ReadingPolicy = { enabled: this.scheduleEnabled,
      bookIds: this.bookIds.split(',').map((id: string) => id.trim()).filter((id: string) => id.length > 0),
      intervalHours: Number(this.interval), timezone: this.timezone.trim(), consent: this.consent };
    await client.readingPolicy(policy);
  }
  private async collect(client: BusinessClient): Promise<void> {
    // Use exactly the visible authorization scope, never an older saved policy.
    await this.savePolicy(client);
    await client.collectReading({ cycleId: newId() });
  }
  private async ask(client: BusinessClient): Promise<void> {
    const text = this.questionText.trim();
    if (!this.selectedBook || !this.selectedEntry || !text || text.length > 1000) { throw new Error('选择来源笔记并填写 1–1000 字疑问'); }
    if (!this.quote || this.quote.length > 1500) { throw new Error('请确认 1–1500 字的连续原始来源片段，不会自动截断笔记'); }
    const question = await client.readingQuestion({ id: newId(), bookId: this.selectedBook, entryId: this.selectedEntry, text: text, quote: this.quote });
    await client.readingAnswer({ questionId: question.id, operationId: newId(), input: text });
    this.questionText = '';
  }
  @Styles
  surface() {
    .width('100%').padding(16).backgroundColor($r('app.color.bg_surface')).borderRadius(12).margin({ bottom: 12 })
  }
  @Builder
  text(value: ResourceStr) {
    Text(value).fontSize(16).lineHeight(24).fontColor($r('app.color.text_primary')).width('100%').copyOption(CopyOptions.InApp)
  }
  @Builder
  action(label: ResourceStr, id: string, callback: () => void, online: boolean = true) {
    Button({ type: ButtonType.Normal }) { Text(label).padding(12).fontColor($r('app.color.selection_text')) }
      .id(id).width('100%').constraintSize({ minHeight: 48 }).backgroundColor($r('app.color.selection_bg'))
      .enabled(!this.busy && (!online || this.connected)).onClick(callback)
  }
  @Builder
  field(label: ResourceStr, id: string, value: string, change: (value: string) => void, secret: boolean = false) {
    this.text(label)
    TextInput({ text: value }).id(id).type(secret ? InputType.Password : InputType.Normal)
      .fontColor($r('app.color.text_primary')).backgroundColor($r('app.color.bg_page')).constraintSize({ minHeight: 48 })
      .enabled(!this.busy).onChange(change)
  }
  @Builder
  book(book: ReadingBook) {
    Column({ space: 10 }) {
      this.text(book.title)
      this.text(book.progress === null ? $r('app.string.reading_unknown') : String(book.progress) + '%')
      this.text(book.source + ' · ' + new Date(book.updatedAt * 1000).toLocaleString())
      if (book.sourceUpdatedAt) { this.text('来源更新：' + new Date(book.sourceUpdatedAt * 1000).toLocaleString()) }
      ForEach(book.cycles, (cycle: ReadingCycle) => {
        this.text('整理状态：' + cycle.state)
        if (cycle.state !== 'completed' && cycle.state !== 'not_submitted') {
          this.action($r('app.string.reading_query'), 'reading-cycle-' + cycle.id, () => {
            this.act(async (client: BusinessClient) => { await client.query(cycle.operationId); });
          })
        }
      }, (cycle: ReadingCycle) => cycle.id)
      if (book.organized) { this.text($r('app.string.reading_organized')); this.text(book.organized) }
      ForEach(book.questions.slice(0, this.questionLimit), (question: ReadingQuestion) => {
        this.text($r('app.string.reading_user_question')); this.text(question.text)
        this.text(question.sourceEntry.text)
        ForEach(question.interactions, (operation: BusinessOperation) => {
          this.text('状态：' + operation.state)
          if (operation.state === 'completed') { this.text(operation.result.message || '') }
          this.action($r('app.string.reading_query'), 'reading-query-' + operation.id, () => {
            this.act(async (client: BusinessClient) => { await client.query(operation.id); });
          })
        }, (operation: BusinessOperation) => operation.id)
        this.action($r('app.string.reading_continue'), 'reading-continue-' + question.id, () => {
          this.act(async (client: BusinessClient) => {
            if (!this.questionText.trim()) { throw new Error('先填写本轮问题'); }
            await client.readingAnswer({ questionId: question.id, operationId: newId(), input: this.questionText.trim() });
            this.questionText = '';
          });
        })
      }, (question: ReadingQuestion) => question.id)
      if (book.questions.length > this.questionLimit) {
        this.action($r('app.string.reading_more_questions'), 'reading-more-questions-' + book.id, () => { this.questionLimit += 20; }, false)
      }
      this.action($r('app.string.reading_select'), 'reading-select-' + book.id, () => { this.selectedBook = book.id; this.selectedEntry = ''; this.entryLimit = 20; }, false)
      if (this.selectedBook === book.id) {
        ForEach(book.entries.slice(0, this.entryLimit), (entry: ReadingEntry) => {
          this.text((entry.kind === 'highlight' ? '原文划线 · ' : '个人想法 · ') + entry.location)
          this.text(entry.text)
          this.action(this.selectedEntry === entry.id ? $r('app.string.reading_selected') : $r('app.string.reading_entry_select'),
            'reading-entry-' + entry.id, () => { this.selectedEntry = entry.id; this.quote = entry.text.length <= 1500 ? entry.text : ''; }, false)
        }, (entry: ReadingEntry) => entry.id)
        if (book.entries.length > this.entryLimit) {
          this.action($r('app.string.reading_more_entries'), 'reading-more-entries-' + book.id, () => { this.entryLimit += 20; }, false)
        }
      }
    }.alignItems(HorizontalAlign.Start).surface()
  }
  build() {
    Column({ space: 12 }) {
      this.text($r('app.string.reading_v1_intro'))
      if (this.message) { this.text(this.message) }
      if (!this.connected) {
        this.field($r('app.string.reading_root'), 'reading-root', this.root, (value: string) => { this.root = value; })
        this.field($r('app.string.reading_token'), 'reading-token', this.token, (value: string) => { this.token = value; }, true)
        Row({ space: 8 }) {
          Toggle({ type: ToggleType.Switch, isOn: this.allowHttp }).onChange((value: boolean) => { this.allowHttp = value; })
          this.text($r('app.string.reading_http'))
        }
        this.action($r('app.string.reading_connect'), 'reading-connect', () => { this.connect(); }, false)
      }
      ForEach(this.collections, (collection: ReadingCollection) => {
        this.text('采集批次：' + collection.state + (collection.error ? ' · ' + collection.error : ''))
      }, (collection: ReadingCollection) => collection.id)
      if (!this.sourceConfigured) { this.text($r('app.string.reading_source_missing')) }
      if (!this.books.length) { this.text($r('app.string.reading_empty')) }
      ForEach(this.books, (book: ReadingBook) => { this.book(book) }, (book: ReadingBook) => book.id)
      if (this.connected) {
        this.text($r('app.string.reading_policy'))
        this.field($r('app.string.reading_scope'), 'reading-scope', this.bookIds, (value: string) => { this.bookIds = value; })
        this.field($r('app.string.reading_interval'), 'reading-interval', this.interval, (value: string) => { this.interval = value; })
        this.field($r('app.string.reading_timezone'), 'reading-timezone', this.timezone, (value: string) => { this.timezone = value; })
        this.text($r('app.string.reading_consent'))
        Toggle({ type: ToggleType.Checkbox, isOn: this.consent }).id('reading-consent').onChange((value: boolean) => { this.consent = value; })
        this.text($r('app.string.reading_enabled'))
        Toggle({ type: ToggleType.Switch, isOn: this.scheduleEnabled }).id('reading-enabled').onChange((value: boolean) => { this.scheduleEnabled = value; })
        if (this.scheduleEnabled && this.nextAt) { this.text('下次周期检查：' + new Date(this.nextAt * 1000).toLocaleString()) }
        this.action($r('app.string.reading_save_policy'), 'reading-save-policy', () => { this.act(async (c: BusinessClient) => { await this.savePolicy(c); }); })
        this.action($r('app.string.reading_collect'), 'reading-collect', () => { this.act(async (c: BusinessClient) => { await this.collect(c); }); })
        this.action($r('app.string.reading_refresh'), 'reading-refresh', () => { this.act(async () => {}); })
        this.field($r('app.string.reading_quote'), 'reading-quote', this.quote, (value: string) => { this.quote = value; })
        this.field($r('app.string.reading_input'), 'reading-question-input', this.questionText, (value: string) => { this.questionText = value; })
        this.action($r('app.string.reading_ask'), 'reading-ask', () => { this.act(async (c: BusinessClient) => { await this.ask(c); }); })
      }
    }.width('100%').alignItems(HorizontalAlign.Start)
  }
}
