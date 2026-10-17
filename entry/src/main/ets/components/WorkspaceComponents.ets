@Component
export struct SectionHeading {
  @Prop title: string = '';
  @Prop subtitle: string = '';

  build() {
    Column({ space: $r('app.float.space_tight') }) {
      Text(this.title).fontSize($r('app.float.font_page_title')).fontWeight(FontWeight.Medium).fontColor($r('app.color.text_primary'))
      Text(this.subtitle).fontSize($r('app.float.font_aux')).lineHeight(21).fontColor($r('app.color.text_secondary'))
    }.alignItems(HorizontalAlign.Start).width('100%').margin({ bottom: $r('app.float.space_section_gap') })
  }
}

@Component
export struct WorkspaceAction {
  @Prop label: string = '';
  @Prop active: boolean = true;
  @Prop primary: boolean = false;
  @Prop actionId: string = '';
  action: () => void = () => {};

  build() {
    Button({ type: ButtonType.Normal }) {
      Text(this.label).fontSize($r('app.float.font_body')).fontWeight(FontWeight.Medium)
        .fontColor(!this.active ? $r('app.color.disabled_text') :
          (this.primary ? $r('app.color.action_on_primary') : $r('app.color.selection_text')))
        .padding({ top: $r('app.float.space_card_gap'), bottom: $r('app.float.space_card_gap'), left: $r('app.float.space_card_inner'), right: $r('app.float.space_card_inner') })
    }.id(this.actionId).width('100%').constraintSize({ minHeight: $r('app.float.touch_min') }).borderRadius($r('app.float.radius_field'))
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
