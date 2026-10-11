import { Project, ProjectDraft, ProjectMilestone, ProjectReview, Space, projectDraft, saveProject,
  projectKindLabel, projectStatusLabel, changeProjectStatus, addProjectMilestone, setProjectMilestone,
  addProjectReview } from '../core/Workspace';

@Component
export struct ProjectPanel {
  @Prop project: Project | undefined = undefined;
  @Prop writable: boolean = false;
  @Prop server: string = '';
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
  }
  private draftKey(): string { return this.server + '/project/' + (this.project?.id || 'new'); }
  private remember(): void { this.drafts.set(this.draftKey(), this.draft); }
  private canEdit(): boolean { return this.writable && this.project?.status !== 'archived'; }
  private async submit(): Promise<void> {
    let id = '';
    if (await this.save((space: Space) => { id = saveProject(space, this.project?.id || '', this.draft); })) {
      this.drafts.delete(this.draftKey()); this.editing = false;
      if (!this.project) { this.opened(id); }
    }
  }
  private async changeStatus(status: string): Promise<void> {
    if (!this.project) { return; }
    const id = this.project.id;
    if (await this.save((space: Space) => { changeProjectStatus(space, id, status, this.draft.review); })) {
      this.confirmation = '';
      if (status === 'completed') { this.draft.review = ''; this.remember(); this.fieldRevision++; }
    }
  }
  private async addMilestone(): Promise<void> {
    if (!this.project) { return; }
    const id = this.project.id;
    if (await this.save((space: Space) => { addProjectMilestone(space, id, this.draft.milestoneTitle, this.draft.milestoneDate); })) {
      this.draft.milestoneTitle = ''; this.draft.milestoneDate = ''; this.remember(); this.fieldRevision++;
    }
  }
  private async addReview(): Promise<void> {
    if (!this.project) { return; }
    const id = this.project.id;
    if (await this.save((space: Space) => { addProjectReview(space, id, this.draft.review); })) {
      this.draft.review = ''; this.remember(); this.fieldRevision++;
    }
  }
  private async toggleMilestone(item: ProjectMilestone): Promise<void> {
    if (!this.project) { return; }
    const id = this.project.id;
    await this.save((space: Space) => { setProjectMilestone(space, id, item.id, !item.done); });
  }
  @Styles
  card() {
    .width('100%').padding(16).borderRadius(16).backgroundColor($r('app.color.bg_surface')).margin({ bottom: 12 })
  }
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
      ForEach(['learning', 'fitness', 'effectiveness', 'software', 'other'], (kind: string) => {
        this.button((this.draft.kind === kind ? '✓ ' : '') + projectKindLabel(kind), 'project-kind-' + kind,
          () => { this.draft.kind = kind; this.remember(); }, this.draft.kind === kind)
      }, (kind: string) => kind)
      this.field($r('app.string.project_goal'), 'project-goal', this.draft.goal, (value: string) => { this.draft.goal = value; }, true)
      this.field($r('app.string.project_criteria'), 'project-criteria', this.draft.criteria, (value: string) => { this.draft.criteria = value; }, true)
      this.field($r('app.string.project_date'), 'project-date', this.draft.targetDate, (value: string) => { this.draft.targetDate = value; })
      this.field($r('app.string.project_next'), 'project-next', this.draft.nextStep, (value: string) => { this.draft.nextStep = value; }, true)
      this.button(this.draft.managedBy === 'agent' ? $r('app.string.project_agent') : $r('app.string.project_manual'), 'project-management',
        () => { this.draft.managedBy = this.draft.managedBy === 'agent' ? 'manual' : 'agent'; this.remember(); })
      this.caption($r('app.string.project_permission'))
      this.button($r('app.string.project_save'), 'project-save', () => { this.submit(); }, true, this.canEdit())
      if (this.project) {
        this.button($r('app.string.project_keep_draft'), 'project-close-editor', () => { this.editing = false; })
      }
    }.alignItems(HorizontalAlign.Start).card()
  }
  @Builder
  overview() {
    Column({ space: 12 }) {
      this.heading($r('app.string.project_goal'))
      this.body(this.project?.goal || '')
      this.heading($r('app.string.project_criteria'))
      this.body(this.project?.criteria || $r('app.string.project_missing_criteria'))
      this.caption($r('app.string.project_target_value', this.project?.targetDate || '未设定'))
      this.heading($r('app.string.project_next'))
      this.body(this.project?.nextStep || $r('app.string.project_no_next'))
      this.caption($r('app.string.project_local'))
      this.button($r('app.string.project_discuss'), 'project-discuss', () => {
        if (this.project) { this.discuss(this.project); }
      }, true, this.canEdit())
      this.button($r('app.string.project_edit'), 'project-edit', () => { this.editing = true; }, false, this.canEdit())
    }.alignItems(HorizontalAlign.Start).card()
    if (this.project?.kind === 'software') {
      Column({ space: 8 }) {
        this.heading($r('app.string.project_remote'))
        this.body($r('app.string.project_remote_hint'))
        this.caption($r('app.string.project_remote_flow'))
      }.alignItems(HorizontalAlign.Start).card()
    }
    this.lifecycle()
  }
  @Builder
  lifecycle() {
    Column({ space: 8 }) {
      this.heading($r('app.string.project_lifecycle'))
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
    Column({ space: 12 }) {
      this.heading($r('app.string.project_milestones'))
      this.caption($r('app.string.project_milestone_hint'))
      if (!(this.project?.milestones || []).length) { this.body($r('app.string.project_no_milestones')) }
      ForEach(this.project?.milestones || [], (item: ProjectMilestone) => {
        this.body(item.title)
        this.caption($r('app.string.project_target_value', item.dueDate || '未设定'))
        this.button(item.done ? $r('app.string.project_milestone_done') : $r('app.string.project_milestone_todo'),
          'project-milestone-' + item.id, () => { this.toggleMilestone(item); }, item.done, this.canEdit())
      }, (item: ProjectMilestone) => item.id)
      if (this.project?.status !== 'archived') {
        this.field($r('app.string.project_milestone_title'), 'project-milestone-title', this.draft.milestoneTitle,
          (value: string) => { this.draft.milestoneTitle = value; })
        this.field($r('app.string.project_date'), 'project-milestone-date', this.draft.milestoneDate,
          (value: string) => { this.draft.milestoneDate = value; })
        this.button($r('app.string.project_add_milestone'), 'project-add-milestone', () => { this.addMilestone(); }, true)
      }
    }.alignItems(HorizontalAlign.Start).card()
  }
  @Builder
  reviews() {
    Column({ space: 12 }) {
      this.heading($r('app.string.project_reviews'))
      this.caption($r('app.string.project_review_hint'))
      if (this.project?.status !== 'archived') {
        this.field($r('app.string.project_review_text'), 'project-review-text', this.draft.review,
          (value: string) => { this.draft.review = value; }, true)
        this.button($r('app.string.project_add_review'), 'project-add-review', () => { this.addReview(); }, true)
      }
      if (!(this.project?.reviews || []).length) { this.body($r('app.string.project_no_reviews')) }
      ForEach((this.project?.reviews || []).slice().reverse(), (item: ProjectReview) => {
        this.caption(new Date(item.createdAt).toLocaleString())
        this.body(item.text)
      }, (item: ProjectReview) => item.id)
    }.alignItems(HorizontalAlign.Start).card()
  }
  build() {
    Column({ space: 8 }) {
      if (this.editing) { this.editor() }
      else if (this.project) {
        Text(this.project.name).fontSize(24).fontWeight(FontWeight.Medium).fontColor($r('app.color.text_primary')).width('100%')
        this.caption(projectKindLabel(this.project.kind) + ' · ' + projectStatusLabel(this.project.status))
        Row({ space: 8 }) {
          Button($r('app.string.project_overview')).id('project-tab-overview').layoutWeight(1).constraintSize({ minHeight: 48 })
            .fontColor(this.section === 'overview' ? $r('app.color.action_on_primary') : $r('app.color.selection_text'))
            .backgroundColor(this.section === 'overview' ? $r('app.color.action_primary') : $r('app.color.selection_bg'))
            .onClick(() => { this.section = 'overview'; })
          Button($r('app.string.project_milestones')).id('project-tab-milestones').layoutWeight(1).constraintSize({ minHeight: 48 })
            .fontColor(this.section === 'milestones' ? $r('app.color.action_on_primary') : $r('app.color.selection_text'))
            .backgroundColor(this.section === 'milestones' ? $r('app.color.action_primary') : $r('app.color.selection_bg'))
            .onClick(() => { this.section = 'milestones'; })
          Button($r('app.string.project_reviews')).id('project-tab-reviews').layoutWeight(1).constraintSize({ minHeight: 48 })
            .fontColor(this.section === 'reviews' ? $r('app.color.action_on_primary') : $r('app.color.selection_text'))
            .backgroundColor(this.section === 'reviews' ? $r('app.color.action_primary') : $r('app.color.selection_bg'))
            .onClick(() => { this.section = 'reviews'; })
        }.width('100%')
        if (this.section === 'overview') { this.overview() }
        else if (this.section === 'milestones') { this.milestones() }
        else { this.reviews() }
      }
    }.width('100%').alignItems(HorizontalAlign.Start)
  }
}
