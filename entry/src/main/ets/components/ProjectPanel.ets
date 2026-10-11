import { Project, ProjectDraft, ProjectMilestone, ProjectReview, Space, projectDraft, saveProject,
  projectKindLabel, projectStatusLabel, changeProjectStatus, addProjectMilestone, setProjectMilestone,
  addProjectReview } from '../core/Workspace';

@Component
export struct ProjectPanel {
  @Prop project: Project | undefined = undefined;
  @Prop error: string = '';
  @Prop solid: boolean = false;
  @BuilderParam actionContent: () => void = this.empty;
  @BuilderParam needsContent: () => void = this.empty;
  addAction: () => void = () => {};
  sync: () => void = () => {};
  @State panel: string = '';
  @State selectedObject: string = '';
  @State options: boolean = false;
  @Prop writable: boolean = false;
  @Prop server: string = '';
  sections: Map<string, string> = new Map();
  drafts: Map<string, ProjectDraft> = new Map();
  save: (change: (space: Space) => void) => Promise<boolean> = async () => false;
  opened: (id: string) => void = () => {};
  discuss: (project: Project) => void = () => {};
  @State draft: ProjectDraft = new ProjectDraft();
  @State editing: boolean = false;
  @State section: string = 'overview';
  @State confirmation: string = '';
  @State fieldRevision: number = 0;

  aboutToAppear(): void {
    this.draft = this.drafts.get(this.draftKey()) || projectDraft(this.project);
    this.editing = !this.project;
    this.section = this.sections.get(this.draftKey()) || 'overview';
  }
  aboutToDisappear(): void { this.sections.set(this.draftKey(), this.section); this.remember(); }
  private draftKey(): string { return this.server + '/project/' + (this.project?.id || 'new'); }
  private remember(): void { this.drafts.set(this.draftKey(), this.draft); }
  private canEdit(): boolean { return this.writable && this.project?.status !== 'archived'; }
  private async submit(): Promise<void> {
    let id = '';
    if (await this.save((space: Space) => { id = saveProject(space, this.project?.id || '', this.draft); })) {
      this.drafts.delete(this.draftKey()); this.editing = false; this.panel = '';
      if (!this.project) { this.opened(id); }
    }
  }
  private async changeStatus(status: string): Promise<void> {
    if (!this.project) { return; }
    const id = this.project.id;
    if (await this.save((space: Space) => { changeProjectStatus(space, id, status, this.draft.review); })) {
      this.confirmation = ''; this.panel = '';
      if (status === 'completed') { this.draft.review = ''; this.remember(); this.fieldRevision++; }
    }
  }
  private async addMilestone(): Promise<void> {
    if (!this.project) { return; }
    const id = this.project.id;
    if (await this.save((space: Space) => { addProjectMilestone(space, id, this.draft.milestoneTitle, this.draft.milestoneDate); })) {
      this.draft.milestoneTitle = ''; this.draft.milestoneDate = ''; this.remember(); this.fieldRevision++; this.panel = '';
    }
  }
  private async addReview(): Promise<void> {
    if (!this.project) { return; }
    const id = this.project.id;
    if (await this.save((space: Space) => { addProjectReview(space, id, this.draft.review); })) {
      this.draft.review = ''; this.remember(); this.fieldRevision++; this.panel = '';
    }
  }
  private async toggleMilestone(item: ProjectMilestone): Promise<void> {
    if (!this.project) { return; }
    const id = this.project.id;
    await this.save((space: Space) => { setProjectMilestone(space, id, item.id, !item.done); });
  }
  @Styles
  card() {
    .width('100%').padding(16).borderRadius(16).backgroundColor(this.solid ? $r('app.color.bg_surface') : $r('app.color.glass_content')).backgroundBlurStyle(this.solid ? BlurStyle.NONE : BlurStyle.Thin).margin({ bottom: 12 })
  }
  @Builder
  empty() {}
  @Builder
  caption(label: ResourceStr) {
    Text(label).fontSize(14).lineHeight(22).fontColor($r('app.color.text_secondary')).width('100%')
  }
  @Builder
  body(label: ResourceStr) {
    Text(label).fontSize(16).lineHeight(25).fontColor($r('app.color.text_primary')).width('100%')
  }
  @Builder
  heading(label: ResourceStr) {
    Text(label).fontSize(18).fontWeight(FontWeight.Medium).fontColor($r('app.color.text_primary')).margin({ top: 16, bottom: 8 })
  }
  @Builder
  button(label: ResourceStr, id: string, action: () => void, primary: boolean = false, enabled: boolean = this.writable) {
    Button({ type: ButtonType.Normal }) {
      Text(label).fontSize(16).padding(12).fontColor(primary ? $r('app.color.action_on_primary') : $r('app.color.selection_text'))
    }.id(id).width('100%').constraintSize({ minHeight: 48 }).borderRadius(12)
      .backgroundColor(primary ? $r('app.color.action_primary') : $r('app.color.selection_bg'))
      .enabled(enabled).opacity(enabled ? 1 : 0.45).onClick(action).margin({ top: 8 })
  }
  @Builder
  field(label: ResourceStr, id: string, value: string, change: (value: string) => void, long: boolean = false) {
    this.caption(label)
    // 保存后只重建输入控件，避免ArkUI初始化text与已清空草稿显示不同步。
    ForEach([this.fieldRevision], (revision: number) => {
      if (long) {
        TextArea({ text: value }).id(id).constraintSize({ minHeight: 100, maxHeight: 180 }).maxLength(4000)
          .fontSize(16).fontColor($r('app.color.text_primary')).backgroundColor($r('app.color.bg_page'))
          .border({ width: 1, color: $r('app.color.border_control'), radius: 12 }).enabled(this.writable)
          .onChange((text: string) => { change(text); this.remember(); })
      } else {
        TextInput({ text: value }).id(id).constraintSize({ minHeight: 48 }).maxLength(200)
          .fontSize(16).fontColor($r('app.color.text_primary')).backgroundColor($r('app.color.bg_page'))
          .border({ width: 1, color: $r('app.color.border_control'), radius: 12 }).enabled(this.writable)
          .onChange((text: string) => { change(text); this.remember(); })
      }
    }, (revision: number) => id + '-' + revision)
  }
  @Builder
  editor() {
    Column({ space: 12 }) {
      this.heading(this.project ? $r('app.string.project_edit') : $r('app.string.project_create'))
      this.caption($r('app.string.project_form_hint'))
      this.field($r('app.string.project_name'), 'project-name', this.draft.name, (value: string) => { this.draft.name = value; })
      this.caption($r('app.string.project_kind'))
      Select([{ value: '学习成长' }, { value: '健身运动' }, { value: '效能提升' }, { value: '软件构建' }, { value: '其他' }])
        .id('project-kind').selected(['learning', 'fitness', 'effectiveness', 'software', 'other'].indexOf(this.draft.kind))
        .value(projectKindLabel(this.draft.kind)).fontColor($r('app.color.text_primary')).width('100%')
        .onSelect((index: number) => { this.draft.kind = ['learning', 'fitness', 'effectiveness', 'software', 'other'][index]; this.remember(); })
      this.field($r('app.string.project_goal'), 'project-goal', this.draft.goal, (value: string) => { this.draft.goal = value; }, true)
      this.field($r('app.string.project_criteria'), 'project-criteria', this.draft.criteria, (value: string) => { this.draft.criteria = value; }, true)
      this.button('选填安排 · ' + (this.draft.targetDate || '未设期限') + (this.draft.nextStep ? ' · 已填下一步' : ''), 'project-options', () => { this.options = !this.options; })
      if (this.options) {
      this.field($r('app.string.project_date'), 'project-date', this.draft.targetDate, (value: string) => { this.draft.targetDate = value; })
      this.field($r('app.string.project_next'), 'project-next', this.draft.nextStep, (value: string) => { this.draft.nextStep = value; }, true)
      this.button(this.draft.managedBy === 'agent' ? $r('app.string.project_agent') : $r('app.string.project_manual'), 'project-management',
        () => { this.draft.managedBy = this.draft.managedBy === 'agent' ? 'manual' : 'agent'; this.remember(); })
      }
      this.caption($r('app.string.project_permission'))
      if (this.error) { Text(this.error).fontSize(14).fontColor($r('app.color.status_error')) }
      this.button($r('app.string.project_save'), 'project-save', () => { this.submit(); }, true, this.canEdit())
      if (this.project) {
        this.button($r('app.string.project_keep_draft'), 'project-close-editor', () => { this.editing = false; })
        this.button('放弃修改', 'project-discard-draft', () => { this.draft = projectDraft(this.project); this.drafts.delete(this.draftKey()); this.editing = false; this.fieldRevision++; })
      }
    }.alignItems(HorizontalAlign.Start).card()
  }
  @Builder
  overview() {
    Column({ space: 8 }) {
      this.heading($r('app.string.project_goal'))
      Text(this.project?.goal || '').fontSize(16).lineHeight(25).maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis })
        .fontColor($r('app.color.text_primary')).width('100%')
      this.caption('目标、完成标准与期限 ›')
    }.alignItems(HorizontalAlign.Start).card().onClick(() => { this.panel = 'goal'; })
    Column({ space: 8 }) {
      this.heading($r('app.string.project_next'))
      this.body(this.project?.nextStep || $r('app.string.project_no_next'))
      this.caption($r('app.string.project_local'))
    }.alignItems(HorizontalAlign.Start).card()
    if (this.project?.status === 'archived') {
      this.button($r('app.string.project_restore'), 'project-restore', () => { this.changeStatus('active'); }, true)
    } else {
      this.button($r('app.string.project_discuss'), 'project-discuss', () => { this.panel = 'discuss'; }, true)
    }
    this.needsContent()
    this.button('阶段成果 ›', 'project-overview-milestones', () => { this.section = 'milestones'; })
    this.button('复盘记录 ›', 'project-overview-reviews', () => { this.section = 'reviews'; })
    if (this.project?.kind === 'software') {
      Column({ space: 8 }) {
        this.heading($r('app.string.project_remote'))
        this.body($r('app.string.project_remote_hint'))
      }.alignItems(HorizontalAlign.Start).card()
    }
  }
  @Builder
  lifecycle() {
    Column({ space: 8 }) {
      this.heading($r('app.string.project_lifecycle'))
      this.button($r('app.string.project_edit'), 'project-edit', () => { this.panel = ''; this.editing = true; }, false, this.canEdit())
      this.button('项目持久会话与显式同步', 'project-sync', () => { this.panel = ''; this.sync(); })
      if (this.project?.status === 'archived') {
        this.caption($r('app.string.project_archive_hint'))
        this.button($r('app.string.project_restore'), 'project-restore', () => { this.changeStatus('active'); })
      } else {
        if (this.project?.status === 'paused' || this.project?.status === 'completed') {
          this.button($r('app.string.project_resume'), 'project-resume', () => { this.changeStatus('active'); })
        } else {
          this.button($r('app.string.project_pause'), 'project-pause', () => { this.changeStatus('paused'); })
          this.button($r('app.string.project_complete'), 'project-complete', () => { this.confirmation = 'completed'; })
        }
        this.button($r('app.string.project_archive'), 'project-archive', () => { this.confirmation = 'archived'; })
      }
      if (this.confirmation === 'completed') {
        this.body(this.project?.criteria || $r('app.string.project_missing_criteria'))
        this.caption($r('app.string.project_complete_hint'))
        this.field($r('app.string.project_evidence'), 'project-completion-evidence', this.draft.review,
          (value: string) => { this.draft.review = value; }, true)
        this.button($r('app.string.project_confirm_complete'), 'project-confirm-complete', () => { this.changeStatus('completed'); }, true)
      } else if (this.confirmation === 'archived') {
        this.caption($r('app.string.project_archive_confirm_hint'))
        this.button($r('app.string.project_confirm_archive'), 'project-confirm-archive', () => { this.changeStatus('archived'); }, true)
      }
      if (this.confirmation) {
        this.button($r('app.string.project_cancel'), 'project-cancel-confirmation', () => { this.confirmation = ''; })
      }
    }.alignItems(HorizontalAlign.Start).card()
  }
  @Builder
  milestones() {
    if (!(this.project?.milestones || []).length) { this.caption($r('app.string.project_no_milestones')) }
    ForEach(this.project?.milestones || [], (item: ProjectMilestone) => {
      Row({ space: 8 }) {
        Checkbox({ name: item.id }).id('project-milestone-' + item.id).select(item.done).width(24).height(24).margin(12)
          .selectedColor($r('app.color.action_primary')).enabled(this.canEdit())
          .accessibilityText(item.title + (item.done ? '，取消完成' : '，标记完成')).onChange(() => { this.toggleMilestone(item); })
        Column({ space: 6 }) {
          Text(item.title).fontSize(16).maxLines(2).fontColor($r('app.color.text_primary'))
          this.caption((item.dueDate || '未设定日期') + (item.done ? ' · 已完成' : ' · 未完成'))
        }.layoutWeight(1).alignItems(HorizontalAlign.Start).constraintSize({ minHeight: 48 })
          .onClick(() => { this.selectedObject = item.id; this.panel = 'milestone-detail'; })
      }.card()
    }, (item: ProjectMilestone) => item.id)
  }
  @Builder
  reviews() {
    if (!(this.project?.reviews || []).length) { this.caption($r('app.string.project_no_reviews')) }
    ForEach((this.project?.reviews || []).slice().reverse(), (item: ProjectReview) => {
      Column({ space: 8 }) {
        this.caption(new Date(item.createdAt).toLocaleString())
        Text(item.text).fontSize(16).lineHeight(25).maxLines(3).textOverflow({ overflow: TextOverflow.Ellipsis }).fontColor($r('app.color.text_primary'))
      }.alignItems(HorizontalAlign.Start).card().onClick(() => { this.selectedObject = item.id; this.panel = 'review-detail'; })
    }, (item: ProjectReview) => item.id)
  }
  @Builder
  sheet() {
    Scroll() {
      Column({ space: 12 }) {
        if (this.error) { Text(this.error).fontSize(14).fontColor($r('app.color.status_error')) }
        this.button('关闭 · 保留草稿', 'project-sheet-close', () => { this.panel = ''; this.confirmation = ''; })
        if (this.panel === 'more') { this.lifecycle() }
        else if (this.panel === 'goal') {
          this.heading($r('app.string.project_goal')); this.body(this.project?.goal || '')
          this.heading($r('app.string.project_criteria')); this.body(this.project?.criteria || $r('app.string.project_missing_criteria'))
          this.caption($r('app.string.project_target_value', this.project?.targetDate || '未设定'))
          this.caption(this.project?.managedBy === 'agent' ? 'Hermes 辅助推进，每次执行需确认' : '手工推进')
        } else if (this.panel === 'add') {
          this.button('每日事项', 'project-new-action', () => { this.panel = ''; this.addAction(); })
          this.button('阶段成果', 'project-new-milestone', () => { this.panel = 'milestone'; }, false, this.canEdit() && (this.project?.milestones || []).length < 100)
          if ((this.project?.milestones || []).length >= 100) { this.caption('阶段成果已达到100项上限') }
          this.button('复盘', 'project-new-review', () => { this.panel = 'review'; })
        } else if (this.panel === 'milestone') {
          this.field($r('app.string.project_milestone_title'), 'project-milestone-title', this.draft.milestoneTitle, (value: string) => { this.draft.milestoneTitle = value; })
          this.field($r('app.string.project_date'), 'project-milestone-date', this.draft.milestoneDate, (value: string) => { this.draft.milestoneDate = value; })
          this.button($r('app.string.project_add_milestone'), 'project-add-milestone', () => { this.addMilestone(); }, true)
        } else if (this.panel === 'review') {
          this.field($r('app.string.project_review_text'), 'project-review-text', this.draft.review, (value: string) => { this.draft.review = value; }, true)
          this.button($r('app.string.project_add_review'), 'project-add-review', () => { this.addReview(); }, true)
        } else if (this.panel === 'milestone-detail') {
          ForEach((this.project?.milestones || []).filter((item: ProjectMilestone) => item.id === this.selectedObject), (item: ProjectMilestone) => {
            this.body(item.title); this.caption(item.dueDate || '未设期限'); this.caption(item.done ? '已完成' : '未完成')
          }, (item: ProjectMilestone) => item.id)
        } else if (this.panel === 'review-detail') {
          ForEach((this.project?.reviews || []).filter((item: ProjectReview) => item.id === this.selectedObject), (item: ProjectReview) => {
            this.caption(new Date(item.createdAt).toLocaleString()); this.body(item.text)
          }, (item: ProjectReview) => item.id)
        } else if (this.panel === 'discuss') {
          this.heading('继续已有需求')
          this.needsContent()
          this.button('发起新需求 · 预览摘要', 'project-new-discussion', () => { this.panel = ''; if (this.project) { this.discuss(this.project); } }, true)
          this.caption('不会自动选择需求或发送；已有会话保留原身份与历史。')
        }
      }.padding(24).alignItems(HorizontalAlign.Start).width('100%')
    }.height('100%').width('100%')
  }
  build() {
    Column({ space: 8 }) {
      if (this.editing) { this.editor() }
      else if (this.project) {
        Text(this.project.name).fontSize(24).fontWeight(FontWeight.Medium).fontColor($r('app.color.text_primary')).width('100%')
        Row({ space: 8 }) {
          if (this.project.status !== 'archived') {
            Button('＋').id('project-add-menu').constraintSize({ minHeight: 48, minWidth: 48 }).backgroundColor(Color.Transparent).fontColor($r('app.color.action_primary')).onClick(() => { this.panel = 'add'; })
          }
          Blank()
          Button('···').id('project-more-menu').constraintSize({ minHeight: 48, minWidth: 48 }).backgroundColor(Color.Transparent).fontColor($r('app.color.action_primary')).accessibilityText('项目更多操作').onClick(() => { this.panel = 'more'; })
        }.width('100%')
        this.caption(projectKindLabel(this.project.kind) + ' · ' + projectStatusLabel(this.project.status))
        Row({ space: 4 }) {
          ForEach(['overview', 'milestones', 'actions', 'reviews'], (section: string) => {
            Button(section === 'overview' ? '概览' : section === 'milestones' ? '阶段' : section === 'actions' ? '行动' : '复盘')
              .id('project-tab-' + section).layoutWeight(1).constraintSize({ minHeight: 48 }).fontSize(14)
              .fontColor($r('app.color.selection_text')).backgroundColor(this.section === section ? $r('app.color.selection_bg') : Color.Transparent)
              .onClick(() => { this.section = section; })
          }, (section: string) => section)
        }.width('100%')
        if (this.section === 'overview') { this.overview() }
        else if (this.section === 'milestones') { this.milestones() }
        else if (this.section === 'actions') { this.actionContent() }
        else { this.reviews() }
      }
    }.width('100%').alignItems(HorizontalAlign.Start)
      .bindSheet(this.panel.length > 0, this.sheet(), { height: SheetSize.LARGE, showClose: true, backgroundColor: $r('app.color.bg_elevated'), onWillDismiss: (action: DismissSheetAction) => { this.panel = ''; this.confirmation = ''; action.dismiss(); } })
  }
}
