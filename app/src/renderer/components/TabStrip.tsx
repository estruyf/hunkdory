import { House, Loader2, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { currentPlatform } from '../lib/platform.ts';
import { formatShortcut, keysFor } from '../lib/shortcuts.ts';
import { INBOX, routeOf, type Tab } from '../state/tabs.ts';
import { useWalkthroughs } from '../state/walkthroughs.ts';
import type { InboxData } from './inbox/useInboxData.ts';

const TAB = 'flex h-8 items-center gap-1.5 rounded-t-lg border border-b-0 text-ui';
const ON = 'border-border bg-bg font-medium text-text';
const OFF = 'border-transparent text-muted hover:bg-selected hover:text-text';

/** Above every view: the inbox, then a tab per open review. It drags the window and clears the traffic lights on macOS. */
export function TabStrip({ tabs, active, inbox, onPick, onClose }: { tabs: Tab[]; active: string; inbox: InboxData; onPick(id: string): void; onClose(id: string): void }) {
  const strip = useRef<HTMLElement>(null);
  // A tab you open or step to past the edge comes into view.
  useEffect(() => {
    strip.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [active]);
  const lights = currentPlatform() === 'darwin' ? 'pl-24' : 'pl-2';
  return (
    <nav ref={strip} aria-label="Open reviews" className={`drag flex h-10 shrink-0 items-end gap-1 overflow-x-auto bg-sidebar pr-2 shadow-[inset_0_-1px_0_var(--sb-border)] [scrollbar-width:none] ${lights}`}>
      {tabs.map((tab) =>
        tab.id === INBOX ? (
          <button key={tab.id} type="button" aria-current={active === tab.id ? 'page' : undefined} className={`${TAB} shrink-0 px-3 ${active === tab.id ? ON : OFF}`} onClick={() => onPick(tab.id)}>
            <House size={14} aria-hidden />
            Inbox
          </button>
        ) : (
          <ReviewTab key={tab.id} tab={tab} on={active === tab.id} inbox={inbox} onPick={() => onPick(tab.id)} onClose={() => onClose(tab.id)} />
        )
      )}
    </nav>
  );
}

function ReviewTab({ tab, on, inbox, onPick, onClose }: { tab: Tab; on: boolean; inbox: InboxData; onPick(): void; onClose(): void }) {
  const r = routeOf(tab);
  const projectId = 'projectId' in r ? r.projectId : undefined;
  const branch = 'branch' in r ? r.branch : tab.id;
  const title = inbox.waiting.find((w) => w.projectId === projectId && w.branch === branch)?.title ?? branch;
  const project = inbox.projects.find((p) => p.id === projectId)?.name;
  // Walkthroughs go on being written in tabs you're not looking at.
  const writing = useWalkthroughs((s) => s.jobs[tab.id]?.status === 'running');
  const ready = useWalkthroughs((s) => !!s.ready[tab.id]);
  return (
    <div
      className={`group relative no-drag min-w-28 flex-[0_1_220px] ${TAB} ${on ? ON : OFF}`}
      onMouseDown={(e) => e.button === 1 && e.preventDefault()}
      onAuxClick={(e) => {
        if (e.button === 1) onClose();
      }}
    >
      <button type="button" aria-current={on ? 'page' : undefined} className="flex h-full min-w-0 flex-1 items-center gap-1.5 rounded-t-lg pr-7 pl-3 text-left" data-tooltip={`${project ? `${project} · ` : ''}${branch}`} onClick={onPick}>
        {writing ? <Loader2 size={12} className="shrink-0 animate-spin text-link" aria-label="Writing a walkthrough" /> : ready ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-unread" role="img" aria-label="Walkthrough ready" /> : null}
        <span className="min-w-0 truncate">{title}</span>
      </button>
      <button
        type="button"
        aria-label={`Close ${title}`}
        data-tooltip={`Close the tab (${formatShortcut(keysFor('tab.close'))}). Your place in the review is kept.`}
        className={`absolute right-1 flex h-5 w-5 items-center justify-center rounded hover:bg-selected focus-visible:opacity-100 group-hover:opacity-100 ${on ? 'opacity-100' : 'opacity-0'}`}
        onClick={onClose}
      >
        <X size={13} aria-hidden />
      </button>
    </div>
  );
}
