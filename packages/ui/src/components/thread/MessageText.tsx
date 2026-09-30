import { isValidElement, useState, type ReactNode } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, Copy } from "lucide-react";

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
          pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
        }}
      >
        {separateLists(text)}
      </Markdown>
    </div>
  );
}

/** A fenced code block with its language and a Copy button. */
function CodeBlock({ children }: { children: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const code = isValidElement<{ className?: string; children?: ReactNode }>(children)
    ? children
    : undefined;
  const language = /language-([\w+-]+)/.exec(code?.props.className ?? "")?.[1];
  const text = String(code?.props.children ?? "").replace(/\n$/, "");

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked (e.g. no focus): nothing to report in the chat.
    }
  };

  return (
    <div className="code-block">
      <div className="code-block-head">
        <span className="code-block-lang">{language ?? "code"}</span>
        <button
          type="button"
          className="code-block-copy"
          onClick={() => void copy()}
          aria-label={copied ? "Copied" : "Copy code"}
        >
          {copied ? <Check size={13} aria-hidden /> : <Copy size={13} aria-hidden />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre>{children}</pre>
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
