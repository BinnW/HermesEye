export interface PickerOption {
  key: string;
  label: string;
}

// Single-choice list: selected row reads soft background with brand text, never a bare checkmark.
@Component
export struct OptionPicker {
  @Prop options: PickerOption[] = [];
  @Prop selected: string = '';
  @Prop active: boolean = true;
  @Prop idPrefix: string = '';
  pick: (key: string) => void = () => {};

  build() {
    Column({ space: $r('app.float.space_tight') }) {
      ForEach(this.options, (option: PickerOption) => {
        Button({ type: ButtonType.Normal }) {
          Text(option.label).fontSize($r('app.float.font_body'))
            .fontWeight(this.selected === option.key ? FontWeight.Medium : FontWeight.Normal)
            .fontColor(this.selected === option.key ? $r('app.color.selection_text') : $r('app.color.text_primary'))
            .textAlign(TextAlign.Start).width('100%')
            .padding({ left: $r('app.float.space_card_inner'), right: $r('app.float.space_card_inner') })
        }.id(this.idPrefix + option.key).width('100%').constraintSize({ minHeight: $r('app.float.touch_min') })
          .borderRadius($r('app.float.radius_field'))
          .backgroundColor(this.selected === option.key ? $r('app.color.selection_bg') : $r('app.color.bg_surface'))
          .stateStyles({
            pressed: {
              .backgroundColor($r('app.color.selection_bg'))
            },
            focused: {
              .border({ width: 2, color: $r('app.color.focus') })
            }
          })
          .enabled(this.active)
          .accessibilityText(option.label + (this.selected === option.key ? '，已选中' : ''))
          .onClick(() => { this.pick(option.key); })
      }, (option: PickerOption) => option.key)
    }.width('100%')
  }
}
