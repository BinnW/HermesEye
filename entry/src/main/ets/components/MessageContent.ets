// Text-only Markdown subset: emphasis, links, fenced code and tables.
// Never interpret HTML from model output.
export interface MessageBlock { kind: string; text: string; rows: string[][]; }
export interface MessageSpan { text: string; url: string; strong: boolean; }
export function messageBlocks(content: string): MessageBlock[] {
  const blocks: MessageBlock[] = [];
  const lines = content.split('\n');
  let code = false;
  let text: string[] = [];
  let rows: string[][] = [];
  const flush = (): void => {
    if (text.length) { blocks.push({ kind: code ? 'code' : 'text', text: text.join('\n'), rows: [] }); text = []; }
    if (rows.length) { blocks.push({ kind: 'table', text: '', rows: rows }); rows = []; }
  };
  for (const line of lines) {
    if (line.trim().startsWith('```')) { flush(); code = !code; }
    else if (!code && line.trim().startsWith('|') && line.trim().endsWith('|')) {
      if (text.length) { flush(); }
      const cells = line.trim().slice(1, -1).split('|').map((cell: string) => cell.trim());
      if (!cells.every((cell: string) => /^:?-+:?$/.test(cell))) { rows.push(cells); }
    } else {
      if (rows.length) { flush(); }
      text.push(line);
    }
  }
  flush();
  return blocks;
}
export function messageSpans(content: string): MessageSpan[] {
  const spans: MessageSpan[] = [];
  const expression = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|\*\*([^*]+)\*\*/g;
  let offset = 0;
  let match: RegExpExecArray | null;
  while ((match = expression.exec(content)) !== null) {
    if (match.index > offset) { spans.push({ text: content.slice(offset, match.index), url: '', strong: false }); }
    spans.push({ text: match[1] || match[3], url: match[2] || '', strong: !!match[3] });
    offset = match.index + match[0].length;
  }
  if (offset < content.length) { spans.push({ text: content.slice(offset), url: '', strong: false }); }
  return spans;
}

@Component
export struct MessageContent {
  @Prop content: string = '';
  openLink: (url: string) => void = () => {};
  build() {
    Column({ space: 12 }) {
      ForEach(messageBlocks(this.content), (block: MessageBlock, index: number) => {
        if (block.kind === 'code') {
          Scroll() {
            Text(block.text).fontFamily('monospace').fontSize(14).lineHeight(22).fontColor($r('app.color.text_primary'))
              .copyOption(CopyOptions.InApp).padding(12)
          }.scrollable(ScrollDirection.Horizontal).width('100%').backgroundColor($r('app.color.bg_page')).borderRadius(8)
        } else if (block.kind === 'table') {
          Scroll() {
            Column({ space: 4 }) {
              ForEach(block.rows, (row: string[], rowIndex: number) => {
                Row({ space: 8 }) {
                  ForEach(row, (cell: string, column: number) => {
                    Text(cell).fontSize(14).lineHeight(22).fontColor($r('app.color.text_primary'))
                      .fontWeight(rowIndex === 0 ? FontWeight.Medium : FontWeight.Normal)
                      .width(140).padding(8).copyOption(CopyOptions.InApp)
                      .accessibilityText((block.rows[0][column] || '列') + '：' + cell)
                  }, (_cell: string, column: number) => String(column))
                }
              }, (_row: string[], rowIndex: number) => String(rowIndex))
            }
          }.scrollable(ScrollDirection.Horizontal).width('100%')
        } else {
          Text() {
            ForEach(messageSpans(block.text), (span: MessageSpan, spanIndex: number) => {
              Span(span.text).fontWeight(span.strong ? FontWeight.Medium : FontWeight.Normal)
                .fontColor(span.url ? $r('app.color.action_primary') : $r('app.color.text_primary'))
                .decoration({ type: span.url ? TextDecorationType.Underline : TextDecorationType.None })
                .onClick(() => { if (span.url) { this.openLink(span.url); } })
            }, (_span: MessageSpan, spanIndex: number) => String(spanIndex))
          }.fontSize(16).lineHeight(25).copyOption(CopyOptions.InApp).width('100%')
        }
      }, (_block: MessageBlock, index: number) => String(index))
    }.width('100%').alignItems(HorizontalAlign.Start)
  }
}
