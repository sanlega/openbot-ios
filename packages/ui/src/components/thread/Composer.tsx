import { useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { ArrowUp, Square } from "lucide-react";

interface ComposerProps {
  botName: string;
  running: boolean;
  onSend: (text: string) => Promise<void> | void;
  onStop: () => void;
  /** Disconnected from OpenBot: keep the draft, don't send. */
  offline?: boolean;
}

const MAX_HEIGHT = 200;

/** Enter sends, Shift+Enter adds a line; grows with the text up to ~8 lines. */
export function Composer({ botName, running, onSend, onStop, offline = false }: ComposerProps) {
  const [draft, setDraft] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
  }, [draft]);

  const send = async (e?: FormEvent) => {
    e?.preventDefault();
    const text = draft.trim();
    if (!text || offline) return;
    setDraft("");
    try {
      await onSend(text);
    } catch {
      // Not sent (e.g. the connection dropped): give the text back.
      setDraft((current) => current || text);
    }
    ref.current?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    }
  };

  return (
    <form className="composer" onSubmit={(e) => void send(e)}>
      <div className="composer-box">
        <textarea
          ref={ref}
          rows={1}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={`Message ${botName}…`}
          aria-label="Message"
        />
        {running && !draft.trim() ? (
          <button
            type="button"
            className="composer-btn composer-stop"
            onClick={onStop}
            aria-label="Stop"
            title="Stop the bot"
          >
            <Square size={12} fill="currentColor" />
          </button>
        ) : (
          <button
            type="submit"
            className="composer-btn"
            disabled={!draft.trim() || offline}
            aria-label="Send"
            title={offline ? "Reconnecting to OpenBot…" : "Send (Enter)"}
          >
            <ArrowUp size={16} strokeWidth={2.5} />
          </button>
        )}
      </div>
      <p className="composer-hint" data-offline={offline || undefined}>
        {offline
          ? "Reconnecting… your message will wait here"
          : "Enter to send · Shift+Enter for a new line"}
      </p>
    </form>
  );
}
