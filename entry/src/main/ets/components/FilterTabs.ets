import { PickerOption } from './OptionPicker';

// Segmented filter row matching the capsule navigation's selected language.
@Component
export struct FilterTabs {
  @Prop options: PickerOption[] = [];
  @Prop selected: string = '';
  @Prop active: boolean = true;
  pick: (key: string) => void = () => {};

  build() {
    Row({ space: 4 }) {
      ForEach(this.options, (option: PickerOption) => {
        Button(option.label, { type: ButtonType.Normal })
          .fontSize($r('app.float.font_aux'))
          .fontWeight(this.selected === option.key ? FontWeight.Medium : FontWeight.Normal)
          .fontColor(this.selected === option.key ? $r('app.color.selection_text') : $r('app.color.text_secondary'))
          .layoutWeight(1).constraintSize({ minHeight: $r('app.float.touch_min') })
          .borderRadius($r('app.float.radius_field'))
          .backgroundColor(this.selected === option.key ? $r('app.color.selection_bg') : Color.Transparent)
          .enabled(this.active)
          .accessibilityText(option.label + (this.selected === option.key ? '，已选中' : ''))
          .onClick(() => { this.pick(option.key); })
      }, (option: PickerOption) => option.key)
    }.width('100%').padding(4).borderRadius($r('app.float.radius_field'))
      .backgroundColor($r('app.color.bg_surface'))
      .margin({ bottom: $r('app.float.space_card_gap') })
  }
}
