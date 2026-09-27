import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Bot text is Markdown (engines answer in it). Raw HTML in it is not rendered,
 * and links open outside the app.
 */
export function MessageText({ text, markdown }: { text: string; markdown: boolean }) {
  if (!markdown) return <div className="message-text-plain">{text}</div>;
  return (
    <div className="message-markdown">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {separateLists(text)}
      </Markdown>
    </div>
  );
}

/**
 * Engines often write a heading line straight above a list ("**Work**\n4. …").
 * In Markdown a list that does not start at 1 cannot interrupt a paragraph, so it
 * would render inline; a blank line before list items keeps the list a list.
 */
function separateLists(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  for (const line of lines) {
    const prev = out[out.length - 1];
    const isItem = /^\s{0,3}(\d+[.)]|[-*+])\s/.test(line);
    const prevIsText =
      prev !== undefined && prev.trim() !== "" && !/^\s*(\d+[.)]|[-*+])\s/.test(prev);
    if (isItem && prevIsText && !/^\s{4,}/.test(line)) out.push("");
    out.push(line);
  }
  return out.join("\n");
}
