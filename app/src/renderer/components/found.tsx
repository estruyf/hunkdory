import { Loading, plural, useAsync } from './ui.tsx';
import { ProjectIcon } from './ProjectIcon.tsx';
import { useEffect } from 'react';
import { matches } from '../lib/shortcuts.ts';
import { useTabActive } from '../state/tabPane.ts';
import { Kbd } from './ui/Kbd.tsx';
import { Notice } from './ui/Notice.tsx';
import { SectionHeader } from './ui/SectionHeader.tsx';
import { timeAgo } from '../../shared/order.ts';
import { thisComputer } from '../lib/platform.ts';

/**
 * Repos with recent Claude Code or Copilot sessions that aren't projects yet, as rows you pick with a click or ⌘1 to ⌘9
 * (the registry's `welcome.pick`). Connected repos drop out of the list.
 */
export function FoundOnThisMac({ onPick, title = `Found on ${thisComputer()}`, primary = true }: { onPick: (path: string) => void; title?: string; primary?: boolean }) {
  const found = useAsync(() => window.api.foundOnThisMac(), []);
  // ⌘1 to ⌘9 pick the repo on that row.
  const onScreen = useTabActive();
  useEffect(() => {
    if (!onScreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (!matches(e, 'welcome.pick')) return;
      const f = found.value?.[Number(e.key) - 1];
      if (!f) return;
      e.preventDefault();
      onPick(f.path);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [found.value, onPick, onScreen]);
  return (
    <section className="flex flex-col gap-1" aria-label={title}>
      <SectionHeader count={found.value?.length ?? null}>{title}</SectionHeader>
      {found.loading && <Loading label="Looking for repos you use an agent in…" />}
      {found.error && <Notice tone="error">{found.error}</Notice>}
      {found.value?.length === 0 && <Notice>No repos with Claude Code or Copilot sessions on {thisComputer()}{primary ? ' yet' : ''}. Choose a folder instead: any git repo works.</Notice>}
      <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
        {found.value?.map((f, i) => (
          <li key={f.path}>
            <button type="button" onClick={() => onPick(f.path)} aria-label={`Connect ${f.name}`} className="flex h-13 w-full items-center gap-3 rounded-lg px-3 text-left hover:bg-border/45">
              <ProjectIcon name={f.name} icon={f.icon} size={24} />
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

