import { Note } from '../core/Domain';

@Component
export struct SectionHeading {
  @Prop title: string = '';
  @Prop subtitle: string = '';

  build() {
    Column({ space: 8 }) {
      Text(this.title).fontSize(24).fontWeight(FontWeight.Medium).fontColor($r('app.color.text_primary'))
      Text(this.subtitle).fontSize(14).lineHeight(21).fontColor($r('app.color.text_secondary'))
    }.alignItems(HorizontalAlign.Start).width('100%').margin({ bottom: 24 })
  }
}

@Component
export struct WorkspaceAction {
  @Prop label: string = '';
  @Prop active: boolean = true;
  @Prop primary: boolean = false;
  action: () => void = () => {};

  build() {
    Button({ type: ButtonType.Normal }) {
      Text(this.label).fontSize(16).fontWeight(FontWeight.Medium)
        .fontColor(!this.active ? $r('app.color.disabled_text') :
          (this.primary ? $r('app.color.action_on_primary') : $r('app.color.selection_text')))
        .padding({ top: 12, bottom: 12, left: 16, right: 16 })
    }.width('100%').constraintSize({ minHeight: 48 }).borderRadius(12)
      .backgroundColor(!this.active ? $r('app.color.disabled_bg') :
        (this.primary ? $r('app.color.action_primary') : $r('app.color.bg_surface')))
      .stateStyles({
        pressed: {
          .backgroundColor(this.primary ? $r('app.color.action_pressed') : $r('app.color.selection_bg'))
        },
        focused: {
          .border({ width: 2, color: $r('app.color.focus') })
        }
      })
      .enabled(this.active).onClick(this.action)
  }
}

@Component
export struct RecordCard {
  @Prop note: Note;
  @Prop writable: boolean = false;
  @Prop saved: boolean = true;
  remove: () => void = () => {};

  build() {
    Column({ space: 8 }) {
      Text('记录时间 · ' + new Date(this.note.createdAt).toLocaleTimeString())
        .fontSize(14).fontColor($r('app.color.text_secondary'))
      Text(this.note.text).fontSize(16).lineHeight(24).fontColor($r('app.color.text_primary'))
        .copyOption(CopyOptions.InApp)
      Text(this.saved ? '✓ 已保存到本机' : '！本机保存状态待确认')
        .fontSize(14).fontColor(this.saved ? $r('app.color.status_success') : $r('app.color.status_warning'))
      Button('删除记录', { type: ButtonType.Normal }).constraintSize({ minHeight: 48 })
        .fontSize(16).fontColor($r('app.color.status_error')).backgroundColor(Color.Transparent)
        .enabled(this.writable).onClick(this.remove)
    }.alignItems(HorizontalAlign.Start).padding(16).width('100%')
      .backgroundColor($r('app.color.bg_surface')).borderRadius(16)
  }
}
