import { useEffect, useState } from "react";
import type { DigestContent } from "../../api/types.js";
import { useOpenBot } from "../../state/context.js";

interface DigestMessageProps {
  postedAt?: string;
}

export function DigestMessage({ postedAt }: DigestMessageProps) {
  const { transport } = useOpenBot();
  const [digest, setDigest] = useState<DigestContent | null>(null);

  useEffect(() => {
    void transport.get<{ digest: DigestContent | null }>("/api/digest").then((r) => setDigest(r.digest));
  }, [transport]);

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
