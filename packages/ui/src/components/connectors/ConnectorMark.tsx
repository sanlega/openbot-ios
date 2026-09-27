/** A letter mark per app until connectors ship real logos; the color is stable per name. */
const HUES = [212, 262, 300, 340, 18, 38, 150, 176, 196];

export function ConnectorMark({ name, size = 32 }: { name: string; size?: number }) {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const hue = HUES[hash % HUES.length]!;
  return (
    <span
      className="conn-mark"
      aria-hidden
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.42),
        color: `hsl(${hue} 70% 62%)`,
        background: `hsl(${hue} 60% 50% / 0.14)`,
      }}
    >
      {name.trim().charAt(0).toUpperCase()}
    </span>
  );
}
