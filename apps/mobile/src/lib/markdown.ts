/** A deliberately small Markdown subset for chat bubbles: code blocks, lists, bold, inline code. */
export type Span = { text: string; bold?: boolean; code?: boolean; italic?: boolean };
export type Block =
  | { type: "code"; text: string }
  | { type: "heading"; spans: Span[] }
  | { type: "paragraph"; spans: Span[] }
  | { type: "bullet"; marker: string; spans: Span[] };

export function parseMarkdown(source: string): Block[] {
  const blocks: Block[] = [];
  const parts = source.replace(/\r\n/g, "\n").split(/^```[^\n]*\n?/m);
  parts.forEach((part, index) => {
    if (index % 2 === 1) {
      blocks.push({ type: "code", text: part.replace(/\n$/, "") });
      return;
    }
    let paragraph: string[] = [];
    const flush = () => {
      if (paragraph.length)
        blocks.push({ type: "paragraph", spans: parseInline(paragraph.join(" ")) });
      paragraph = [];
    };
    for (const line of part.split("\n")) {
      const heading = /^\s{0,3}#{1,6}\s+(.*)$/.exec(line);
      const bullet = /^\s*([-*+]|\d+[.)])\s+(.*)$/.exec(line);
      if (!line.trim()) flush();
      else if (heading) {
        flush();
        blocks.push({ type: "heading", spans: parseInline(heading[1]!) });
      } else if (bullet) {
        flush();
        const marker = /\d/.test(bullet[1]!) ? bullet[1]! : "•";
        blocks.push({ type: "bullet", marker, spans: parseInline(bullet[2]!) });
      } else paragraph.push(line.trim());
    }
    flush();
  });
  return blocks;
}

export function parseInline(text: string): Span[] {
  const spans: Span[] = [];
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\*[^*\s][^*]*\*|\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const token = match[0];
    const start = match.index ?? 0;
    if (start > last) spans.push({ text: text.slice(last, start) });
    if (token.startsWith("`")) spans.push({ text: token.slice(1, -1), code: true });
    else if (token.startsWith("**") || token.startsWith("__"))
      spans.push({ text: token.slice(2, -2), bold: true });
    else if (token.startsWith("[")) spans.push({ text: /^\[([^\]]+)\]/.exec(token)![1]! });
    else spans.push({ text: token.slice(1, -1), italic: true });
    last = start + token.length;
  }
  if (last < text.length) spans.push({ text: text.slice(last) });
  return spans;
}
