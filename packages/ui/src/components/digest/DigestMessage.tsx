import { useEffect, useState } from "react";
import type { DigestContent } from "../../api/types.js";
import { useOpenBot } from "../../state/context.js";

interface DigestMessageProps {
  postedAt?: string;
  /** The digest message's text, as the harness posts it; without it, the latest digest is fetched. */
  text?: string;
}

/**
 * Parses the harness digest body ("Daily digest", then "Title:" lines each
 * followed by "- item" lines) into sections.
 */
export function parseDigestText(text: string, postedAt: string): DigestContent {
  const sections: DigestContent["sections"] = [];
  for (const raw of text.split("\n").slice(1)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("- ")) {
      if (sections.length === 0) sections.push({ title: "Summary", items: [] });
      sections[sections.length - 1]!.items.push(line.slice(2));
    } else if (line.endsWith(":")) {
      sections.push({ title: line.slice(0, -1), items: [] });
    } else {
      sections.push({ title: "Summary", items: [line] });
    }
  }
  return { id: `digest_${postedAt}`, postedAt, sections };
}

export function DigestMessage({ postedAt, text }: DigestMessageProps) {
  const { transport } = useOpenBot();
  const [fetched, setFetched] = useState<DigestContent | null>(null);
  const digest = text ? parseDigestText(text, postedAt ?? new Date().toISOString()) : fetched;

  useEffect(() => {
    if (text) return;
    void transport
      .get<{ digest: DigestContent | null }>("/api/digest")
      .then((r) => setFetched(r.digest));
  }, [transport, text]);

  if (!digest) return <div className="message-bubble">Loading digest…</div>;

  return (
    <article className="digest-card" data-testid="digest-message">
      <header className="digest-header">
        <span className="badge badge-cos">Daily digest</span>
        <time dateTime={postedAt ?? digest.postedAt}>
          {new Date(postedAt ?? digest.postedAt).toLocaleString()}
        </time>
      </header>
      {digest.sections.map((section) => (
        <section key={section.title} className="digest-section">
          <h4>{section.title}</h4>
          <ul>
            {section.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      ))}
    </article>
  );
}
