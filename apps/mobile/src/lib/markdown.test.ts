import { describe, expect, it } from "vitest";
import { parseInline, parseMarkdown } from "./markdown";

describe("chat markdown", () => {
  it("splits code blocks, headings, bullets, and paragraphs", () => {
    const blocks = parseMarkdown(
      "# Plan\nFirst line\nsecond line\n\n- one\n2. two\n```ts\nconst a = 1;\n```\nDone",
    );
    expect(blocks.map((block) => block.type)).toEqual([
      "heading",
      "paragraph",
      "bullet",
      "bullet",
      "code",
      "paragraph",
    ]);
    expect(blocks[1]).toEqual({ type: "paragraph", spans: [{ text: "First line second line" }] });
    expect(blocks[3]).toMatchObject({ marker: "2." });
    expect(blocks[4]).toEqual({ type: "code", text: "const a = 1;" });
  });

  it("parses bold, italic, inline code, and link text", () => {
    expect(
      parseInline("Run **now** with `pnpm build`, see *docs* and [the guide](https://x.dev)"),
    ).toEqual([
      { text: "Run " },
      { text: "now", bold: true },
      { text: " with " },
      { text: "pnpm build", code: true },
      { text: ", see " },
      { text: "docs", italic: true },
      { text: " and " },
      { text: "the guide" },
    ]);
  });
});
