import { PlanItem, WorkStatus } from '../core/Workspace';
import { WorkspaceAction } from './WorkspaceComponents';

@Component
export struct DailyPlanCard {
  @Prop item: PlanItem;
  @Prop writable: boolean = false;
  @Prop projectName: string = '';
  changeStatus: (id: string, status: WorkStatus) => void = () => {};
  edit: (id: string) => void = () => {};
  discuss: (id: string) => void = () => {};

  build() {
    Column({ space: 8 }) {
      Text(this.item.title).fontSize(18).lineHeight(27).fontWeight(FontWeight.Medium)
        .fontColor($r('app.color.text_primary')).width('100%')
      Text(`${this.item.date} · ${this.item.status === 'done' ? '已完成' : this.item.status === 'doing' ? '进行中' : '待完成'}`)
        .fontSize(14).fontColor($r('app.color.text_secondary'))
      Text(`${this.item.calendarSource ? '手机日历' : '事务'} · ${this.projectName || '独立事项'}${this.item.priority === 'important' ? ' · 重要' : ''}${this.item.minutes ? ' · 预计 ' + this.item.minutes + ' 分钟' : ''}`)
        .fontSize(14).lineHeight(21).fontColor($r('app.color.text_secondary'))
      if (this.item.calendarSource) {
        Text(this.item.calendarSource.allDay ? '全天日程（不折算占用分钟）' :
          new Date(this.item.calendarSource.start).toLocaleString() + ' — ' + new Date(this.item.calendarSource.end).toLocaleString())
          .fontSize(14).lineHeight(21).fontColor($r('app.color.text_secondary'))
      }
      if (this.item.note) {
        Text(this.item.note).fontSize(16).lineHeight(24).fontColor($r('app.color.text_primary'))
      }
      if (this.item.suggestionReason) {
        Text('采纳依据：' + this.item.suggestionReason).fontSize(14).lineHeight(21).fontColor($r('app.color.text_secondary'))
      }
      Row({ space: 8 }) {
        ForEach(['todo', 'doing', 'done'], (status: string) => {
          Button((this.item.status === status ? '✓ ' : '') + (status === 'todo' ? '待完成' : status === 'doing' ? '进行中' : '已完成'), { type: ButtonType.Normal })
            .layoutWeight(1).constraintSize({ minHeight: 48 }).fontSize(14).borderRadius(12)
            .backgroundColor(this.item.status === status ? $r('app.color.selection_bg') : $r('app.color.bg_page'))
            .fontColor($r('app.color.selection_text')).enabled(this.writable)
            .onClick(() => { this.changeStatus(this.item.id, status as WorkStatus); })
        }, (status: string) => status)
      }.width('100%')
      WorkspaceAction({ label: '编辑 / 改期', active: this.writable, action: () => { this.edit(this.item.id); } })
      WorkspaceAction({ label: '继续事项会话', active: this.writable, action: () => { this.discuss(this.item.id); } })
    }.alignItems(HorizontalAlign.Start).padding(16).width('100%').borderRadius(16)
      .backgroundColor($r('app.color.bg_surface')).margin({ bottom: 12 })
  }
}
