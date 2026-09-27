import { useEffect, useState } from "react";

interface CommandPaletteProps {
  onClose: () => void;
  onNavigate: (view: "bots" | "activity" | "audit") => void;
}

const COMMANDS = [
  { id: "bots", label: "Go to bot list", view: "bots" as const },
  { id: "activity", label: "Open activity log", view: "activity" as const },
  { id: "held", label: "Not delivered filter", view: "activity" as const },
  { id: "audit", label: "Open audit log", view: "audit" as const },
];

export function CommandPalette({ onClose, onNavigate }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  const filtered = COMMANDS.filter((c) => c.label.toLowerCase().includes(query.toLowerCase()));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowDown") setActive((i) => Math.min(i + 1, filtered.length - 1));
      if (e.key === "ArrowUp") setActive((i) => Math.max(i - 1, 0));
      if (e.key === "Enter" && filtered[active]) {
        onNavigate(filtered[active].view);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, onNavigate, filtered, active]);

  return (
    <div className="command-palette-overlay" onClick={onClose} role="presentation">
      <div className="command-palette" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Command palette">
        <input
          autoFocus
          placeholder="Search commands…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
        />
        {filtered.map((cmd, i) => (
          <button
            key={cmd.id}
            type="button"
            className="command-item"
            data-active={i === active}
            onClick={() => onNavigate(cmd.view)}
          >
            {cmd.label}
          </button>
        ))}
      </div>
    </div>
  );
}
