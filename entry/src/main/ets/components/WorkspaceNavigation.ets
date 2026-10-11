// V2 floating capsule; four destinations and accessible labels remain stable.
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
        Image(this.icon).width(21).height(21)
          .fillColor(this.selected ? $r('app.color.action_primary') : $r('app.color.text_secondary'))
        Text(this.label).fontSize(12).lineHeight(19)
          .fontWeight(this.selected ? FontWeight.Medium : FontWeight.Normal)
          .fontColor(this.selected ? $r('app.color.action_primary') : $r('app.color.text_secondary'))
      }.width('100%').padding({ top: 8, bottom: 8, left: 10, right: 10 }).borderRadius(999).clip(true)
    }.id(this.navigationId).width('100%').constraintSize({ minHeight: 54 }).borderRadius(999)
      .backgroundColor(this.selected ? $r('app.color.selection_bg') : Color.Transparent).clip(true)
      .accessibilityText(this.label + (this.selected ? '，已选中' : ''))
      .onClick(this.select)
  }
}
