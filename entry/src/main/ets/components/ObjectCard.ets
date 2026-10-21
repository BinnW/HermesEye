// Shared overview card: title plus auxiliary lines, whole card is the detail entry.
// progress in [0,1] renders a thin bar with progressText; negative hides it.
@Component
export struct ObjectCard {
  @Prop title: string = '';
  @Prop lines: string[] = [];
  @Prop solid: boolean = false;
  @Prop cardId: string = '';
  @Prop actionText: string = '查看详情';
  @Prop progress: number = -1;
  @Prop progressText: string = '';
  open: () => void = () => {};

  build() {
    Column({ space: $r('app.float.space_tight') }) {
      Text(this.title).fontSize($r('app.float.font_body')).fontWeight(FontWeight.Medium).lineHeight(25)
        .maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis })
        .fontColor($r('app.color.text_primary')).width('100%')
      ForEach(this.lines, (line: string, index: number) => {
        Text(line).fontSize($r('app.float.font_aux')).lineHeight(21).maxLines(2)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .fontColor($r('app.color.text_secondary')).width('100%')
      }, (line: string, index: number) => this.title + '-' + index)
      if (this.progress >= 0) {
        Row({ space: $r('app.float.space_tight') }) {
          Progress({ value: Math.round(this.progress * 100), total: 100, type: ProgressType.Linear })
            .layoutWeight(1).color($r('app.color.action_primary')).backgroundColor($r('app.color.selection_bg'))
            .style({ strokeWidth: 6 })
          Text(this.progressText).fontSize($r('app.float.font_small')).fontColor($r('app.color.text_secondary'))
        }.width('100%').accessibilityText(this.progressText)
      }
    }.alignItems(HorizontalAlign.Start).padding($r('app.float.space_card_inner')).width('100%')
      .borderRadius($r('app.float.radius_card'))
      .backgroundColor(this.solid ? $r('app.color.bg_surface') : $r('app.color.glass_content'))
      .backgroundBlurStyle(this.solid ? BlurStyle.NONE : BlurStyle.Thin)
      .margin({ bottom: $r('app.float.space_card_gap') })
      .id(this.cardId)
      .accessibilityText(this.title + '，' + this.actionText)
      .onClick(() => { this.open(); })
  }
}
