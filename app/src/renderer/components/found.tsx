import { Loading, plural, useAsync } from './ui.tsx';
import { ProjectIcon } from './ProjectIcon.tsx';
import { useEffect } from 'react';
import { matches } from '../lib/shortcuts.ts';
import { Kbd } from './ui/Kbd.tsx';
import { Notice } from './ui/Notice.tsx';
import { SectionHeader } from './ui/SectionHeader.tsx';
import { timeAgo } from '../../shared/order.ts';

/**
 * Repos with recent Claude Code sessions that aren't projects yet, as rows you pick with a click or ⌘1 to ⌘9
 * (the registry's `welcome.pick`). Connected repos drop out of the list.
 */
export function FoundOnThisMac({ onPick, title = 'Found on this Mac', primary = true }: { onPick: (path: string) => void; title?: string; primary?: boolean }) {
  const found = useAsync(() => window.api.foundOnThisMac(), []);
  // ⌘1 to ⌘9 pick the repo on that row.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!matches(e, 'welcome.pick')) return;
      const f = found.value?.[Number(e.key) - 1];
      if (!f) return;
      e.preventDefault();
      onPick(f.path);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [found.value, onPick]);
  return (
    <section className="flex flex-col gap-1" aria-label={title}>
      <SectionHeader count={found.value?.length ?? null}>{title}</SectionHeader>
      {found.loading && <Loading label="Looking for Claude Code sessions…" />}
      {found.error && <Notice tone="error">{found.error}</Notice>}
      {found.value?.length === 0 && <Notice>No other repos with Claude Code sessions in your Claude Code config folders (~/.claude and any ~/.claude-*).</Notice>}
      <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
        {found.value?.map((f, i) => (
          <li key={f.path}>
            <button type="button" onClick={() => onPick(f.path)} aria-label={`Connect ${f.name}`} className="flex h-13 w-full items-center gap-3 rounded-lg px-3 text-left hover:bg-border/45">
              <ProjectIcon name={f.name} size={24} />
              <span className="grid min-w-0 flex-1">
                <span className="truncate text-body font-semibold">{f.name}</span>
                <span className="truncate font-mono text-meta text-faint">
                  {f.path} · {plural(f.sessions, 'session')} · {timeAgo(f.lastActive)}
                </span>
              </span>
              {i < 9 && <Kbd keys={`mod+${i + 1}`} />}
              {i === 0 && primary && <span className="text-ui font-semibold text-accent-ink">Connect →</span>}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

