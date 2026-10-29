/** Stable, readable colour per project name (Switchboard's `letterColor`): the tile behind a project's letter. */
export function letterColor(name: string): string {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return `hsl(${hash % 360} 45% 42%)`;
}

/**
 * A project as a coloured letter tile, as Switchboard draws a project without an icon. `label` puts other
 * letters on the project's colour, such as a branch's initials on the rail.
 */
export function ProjectIcon({ name, size = 20, label }: { name: string; size?: number; label?: string }) {
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-[5px] font-semibold text-white"
      style={{ width: size, height: size, fontSize: Math.round(size * (label && label.length > 1 ? 0.42 : 0.5)), background: letterColor(name) }}
    >
      {label ?? (name.trim()[0] ?? '?').toUpperCase()}
    </span>
  );
}
