// Mirrors the .he-nav in docs/design/V1.0/connection-and-needs.html.
@Component
export struct WorkspaceNavigationItem {
  @Prop label: string = '';
  @Prop icon: Resource;
  @Prop selected: boolean = false;
  @Prop navigationId: string = '';
  select: () => void = () => {};

  build() {
    Button({ type: ButtonType.Normal }) {
      Column({ space: 3 }) {
        Image(this.icon).width(19).height(19)
          .fillColor(this.selected ? $r('app.color.action_primary') : $r('app.color.text_secondary'))
        Text(this.label).fontSize(12).lineHeight(19)
          .fontWeight(this.selected ? FontWeight.Medium : FontWeight.Normal)
          .fontColor(this.selected ? $r('app.color.action_primary') : $r('app.color.text_secondary'))
      }.width('100%').padding({ top: 8, bottom: 8, left: 10, right: 10 })
    }.id(this.navigationId).width('100%').constraintSize({ minHeight: 48 }).borderRadius(12)
      .backgroundColor(this.selected ? $r('app.color.selection_bg') : Color.Transparent)
      .stateStyles({
        pressed: {
          .backgroundColor($r('app.color.selection_bg'))
        },
        focused: {
          .border({ width: 2, color: $r('app.color.focus') })
        }
      })
      .accessibilityText(this.label + (this.selected ? '，已选中' : ''))
      .onClick(this.select)
  }
}
