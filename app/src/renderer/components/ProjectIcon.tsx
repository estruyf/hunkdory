import { useState } from 'react';
import { useProjectIcons } from '../state/projectIcons.ts';
import type { ProjectIconValue } from '../../shared/types.ts';

/** Stable, readable colour per project name (Switchboard's `letterColor`): the tile behind a project's letter. */
export function letterColor(name: string): string {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  // Dark enough for white letters at 4.5:1 on every hue.
  return `hsl(${hash % 360} 45% 33%)`;
}

/**
 * A project's icon: its image, its emoji, or its first letter on a coloured tile. `projectId` finds a connected
 * project's icon; `icon` gives one directly, for a repo that isn't a project yet. `label` puts other letters on the
 * project's colour, such as a branch's initials on the rail.
 */
export function ProjectIcon({ name, size = 20, label, projectId, icon: given }: { name: string; size?: number; label?: string; projectId?: string; icon?: ProjectIconValue | null }) {
  const saved = useProjectIcons((s) => (projectId ? s.icons[projectId]?.icon : null));
  const icon = label ? null : given !== undefined ? given : saved;
  // A repo's file can have the right name and not be an image: the letter takes over.
  const [broken, setBroken] = useState<string | null>(null);
  // Corners scale with the icon, so large ones read as tiles rather than squares.
  const box = { width: size, height: size, borderRadius: Math.max(3, Math.round(size * 0.22)) };
  if (icon?.kind === 'image' && broken !== icon.dataUrl) {
    return <img src={icon.dataUrl} alt="" style={box} className="shrink-0 object-contain" draggable={false} onError={() => setBroken(icon.dataUrl)} />;
  }
  if (icon?.kind === 'emoji') {
    return (
      <span aria-hidden style={{ ...box, fontSize: size * 0.85, lineHeight: `${size}px` }} className="shrink-0 text-center">
        {icon.value}
      </span>
    );
  }
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-[5px] font-semibold text-white"
      style={{ width: size, height: size, fontSize: Math.round(size * (label && label.length > 1 ? 0.42 : 0.62)), background: letterColor(name) }}
    >
      {label ?? (name.trim()[0] ?? '?').toUpperCase()}
    </span>
  );
}
