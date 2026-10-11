import { PlanItem, WorkStatus } from '../core/Workspace';

@Component
export struct DailyPlanCard {
  @Prop @Watch('syncCompletion') item: PlanItem;
  @Prop @Watch('syncCompletion') writable: boolean = false;
  @Prop projectName: string = '';
  @Prop solid: boolean = false;
  changeStatus: (id: string, status: WorkStatus) => Promise<void> = async () => {};
  edit: (id: string) => void = () => {};
  discuss: (id: string) => void = () => {};
  open: (id: string) => void = () => {};

  @State checked: boolean = false;
  aboutToAppear(): void { this.syncCompletion(); }
  private syncCompletion(): void { this.checked = this.item.status === 'done'; }
  private async complete(selected: boolean): Promise<void> {
    if (!this.writable || this.item.calendarSource) { return; }
    this.checked = selected;
    try { await this.changeStatus(this.item.id, selected ? 'done' : 'todo'); }
    finally { this.syncCompletion(); }
  }
  build() {
    Row({ space: 4 }) {
      if (!this.item.calendarSource) {
        Checkbox({ name: this.item.id }).id('plan-complete-' + this.item.id)
          .select(this.checked).width(24).height(24).margin(12)
          .selectedColor($r('app.color.action_primary')).enabled(this.writable)
          .accessibilityText(this.item.title + (this.item.status === 'done' ? '，重新打开为待完成' : '，标记完成'))
          .onChange((selected: boolean) => { this.complete(selected); })
      } else {
        Image($r('app.media.nav_today')).width(24).height(24).margin(12).fillColor($r('app.color.text_secondary'))
      }
      Button({ type: ButtonType.Normal }) {
        Column({ space: 6 }) {
          Text(this.item.title).fontSize(16).lineHeight(25).fontWeight(FontWeight.Medium)
            .decoration({ type: this.item.status === 'done' ? TextDecorationType.LineThrough : TextDecorationType.None })
            .maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis }).fontColor($r('app.color.text_primary')).width('100%')
          Text(`${this.projectName || '独立事项'} · ${this.item.status === 'done' ? '已完成' : this.item.status === 'doing' ? '进行中' : '待完成'}${this.item.priority === 'important' ? ' · 重要' : ''}`)
            .fontSize(14).lineHeight(22).fontColor($r('app.color.text_secondary')).width('100%')
          if (this.item.calendarSource) {
            Text(this.item.calendarSource.allDay ? '全天日程' : new Date(this.item.calendarSource.start).toLocaleTimeString())
              .fontSize(14).fontColor($r('app.color.text_secondary'))
          }
        }.alignItems(HorizontalAlign.Start).padding({ top: 16, bottom: 16, right: 16 }).width('100%')
      }.id('plan-detail-' + this.item.id).layoutWeight(1).constraintSize({ minHeight: 48 })
        .backgroundColor(Color.Transparent).borderRadius(16).accessibilityText(this.item.title + '，查看完整详情')
        .onClick(() => { this.open(this.item.id); })
    }.width('100%').borderRadius(16).backgroundColor(this.solid ? $r('app.color.bg_surface') : $r('app.color.glass_content'))
      .backgroundBlurStyle(this.solid ? BlurStyle.NONE : BlurStyle.Thin).margin({ bottom: 12 })
  }
}
