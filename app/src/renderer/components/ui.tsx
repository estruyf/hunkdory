import { Loader2 } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import type { ReviewerApi, ReviewState, RiskLevel } from '../../shared/types.ts';
import type { Go } from '../App.tsx';
import { RISK_LABEL } from '../../shared/order.ts';
import { Pill } from './ui/Pill.tsx';
import { ViewHeader } from './ViewHeader.tsx';

/** The Hunkdory app icon: three diff lines and a check on a blue tile. */
export function Logo({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="100 100 824 824" aria-hidden="true" className="shrink-0">
      <rect x="100" y="100" width="824" height="824" rx="185" fill="#3451d1" />
      <rect x="232" y="290" width="300" height="80" rx="40" fill="#FF8E85" />
      <rect x="232" y="412" width="470" height="80" rx="40" fill="#7BE3A6" />
      <rect x="232" y="534" width="390" height="80" rx="40" fill="#7BE3A6" />
      <rect x="232" y="656" width="230" height="80" rx="40" fill="#fff" fillOpacity="0.28" />
      <path d="M548 700 L642 794 L812 594" fill="none" stroke="#fff" strokeWidth="80" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export interface Crumb {
  label: string;
  onClick?: () => void;
  /** Long labels, like a review's title, give way first when space runs out. */
  shrink?: boolean;
}

/** Where you are, in a view's header: every part but the last takes you there; the last is the view's title. */
export function Crumbs({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="min-w-0 overflow-hidden">
      <ol className="m-0 flex min-w-0 list-none items-baseline gap-1.5 p-0">
        {items.map((c, i) => {
          const last = i === items.length - 1;
          return (
            <li key={i} className={`flex min-w-0 items-baseline gap-1.5 ${c.shrink ? 'min-w-[4em] shrink' : last ? 'shrink-0' : 'shrink-[0.001]'}`}>
              {i > 0 && (
                <span aria-hidden className="text-ui text-faint">
                  ›
                </span>
              )}
              {c.onClick && !last ? (
                <button type="button" className="min-w-0 truncate text-ui text-faint hover:text-text" data-tooltip={c.label} onClick={c.onClick}>
                  {c.label}
                </button>
              ) : (
                <span className={`min-w-0 truncate ${last ? 'text-title font-semibold text-text' : 'text-ui text-faint'}`} aria-current={last ? 'page' : undefined}>
                  {c.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** The first crumbs of every review screen: the project, then the branch. */
export const reviewCrumbs = (go: Go, data: { projectId: string; projectName: string }): Crumb[] => [{ label: renamed.get(data.projectId) ?? data.projectName, onClick: () => go({ name: 'home', projectId: data.projectId }) }];

// Projects renamed while the app runs. Screens you go back to may hold review data from before.
const renamed = new Map<string, string>();

/** A project got a new name: show it on the remembered inbox and in review crumbs before anything reloads. */
export function rememberProjectName(projectId: string, name: string) {
  renamed.set(projectId, name);
  const v = lastInbox;
  if (v) setLastInbox({ ...v, waiting: v.waiting.map((w) => (w.projectId === projectId ? { ...w, projectName: name } : w)) });
}

/** How much a step needs you. Not a status colour: needs-attention is something to look at before it goes. */
export function RiskPill({ risk }: { risk: RiskLevel }) {
  return <Pill tone={risk === 'high' ? 'caution' : risk === 'medium' ? 'default' : 'muted'}>{RISK_LABEL[risk]}</Pill>;
}

/** A spinner and a present-tense label, for a list or panel that is loading. `className` replaces the default spacing. */
export function Loading({ label, className = 'py-6' }: { label: string; className?: string }) {
  return (
    <div role="status" className={`flex items-center gap-2 text-ui text-muted ${className}`}>
      <Loader2 size={14} className="animate-spin text-accent-ink" aria-hidden /> {label}
    </div>
  );
}

/**
 * Full-view loading state that keeps the header, so opening a branch doesn't flash a bare spinner.
 * It stays invisible for the first moments; most loads finish before it shows.
 */
export function LoadingPage({ label, detail }: { onHome?: () => void; label: string; detail?: string }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 200);
    return () => clearTimeout(t);
  }, []);
  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <ViewHeader>{detail && <span className="truncate font-mono text-ui text-faint">{detail}</span>}</ViewHeader>
      <div role="status" aria-live="polite" className={`flex flex-1 items-center justify-center pb-[12vh] transition-opacity duration-200 ${visible ? 'opacity-100' : 'opacity-0'}`}>
        <span className="flex items-center gap-2 text-body text-muted">
          <Loader2 size={16} className="animate-spin text-accent-ink" aria-hidden />
          {label}
        </span>
      </div>
    </div>
  );
}

/** Load something async; `reload` re-runs it. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<{ value?: T; error?: string; loading: boolean }>({ loading: true });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setState((s) => ({ ...s, loading: true, error: undefined }));
    fn().then(
      (value) => live && setState({ value, loading: false }),
      (e: Error) => live && setState({ error: cleanError(e), loading: false })
    );
    return () => {
      live = false;
    };
  }, [...deps, tick]);
  return { ...state, reload: () => setTick((t) => t + 1) };
}

type Inbox = Awaited<ReturnType<ReviewerApi['inbox']>>;

// The inbox as last seen. A scan takes seconds, so going back to the inbox shows this while a new one runs.
let lastInbox: Inbox | undefined;
const inboxListeners = new Set<(v: Inbox) => void>();

function setLastInbox(v: Inbox) {
  lastInbox = v;
  for (const fn of inboxListeners) fn(v);
}

/** Puts a review's newest state on the remembered inbox, so its card is right before the next scan is in. */
export function rememberReview(r: ReviewState) {
  const v = lastInbox;
  const i = v?.waiting.findIndex((w) => w.projectId === r.projectId && w.branch === r.branch) ?? -1;
  if (!v || i < 0) return;
  const finished = r.status === 'merged' || r.status === 'discarded' || r.status === 'reviewed';
  const waiting = finished ? v.waiting.filter((_, j) => j !== i) : v.waiting.map((w, j) => (j === i ? { ...w, review: { status: r.status, reviewedSteps: Object.keys(r.reviewed).length } } : w));
  setLastInbox({ ...v, waiting });
}

/** The inbox: the remembered one right away, then a fresh scan. `patch` changes it in place, e.g. right after you ignore a branch. */
export function useInbox() {
  const [value, setValue] = useState(lastInbox);
  const [state, setState] = useState<{ error?: string; loading: boolean }>({ loading: true });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    inboxListeners.add(setValue);
    return () => void inboxListeners.delete(setValue);
  }, []);
  useEffect(() => {
    let live = true;
    setState({ loading: true });
    window.api.inbox().then(
      (v) => {
        // A scan that started before a change you made since is out of date.
        if (!live) return;
        setLastInbox(v);
        setState({ loading: false });
      },
      (e: Error) => live && setState({ error: cleanError(e), loading: false })
    );
    return () => {
      live = false;
    };
  }, [tick]);
  return {
    value,
    ...state,
    reload: () => setTick((t) => t + 1),
    patch: (fn: (v: Inbox) => Inbox) => lastInbox && setLastInbox(fn(lastInbox)),
  };
}

/** IPC errors arrive as "Error invoking remote method 'api:x': Error: message". */
export function cleanError(e: unknown): string {
  return String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
export const sizeText = (files: number, added: number, removed: number) => `${plural(files, 'file')} · +${added} −${removed}`;
/** A setting that sticks between reviews, like the diff layout. Kept in this window's local storage; every screen using it follows a change. */
export function usePref<T extends string | boolean>(key: string, initial: T): [T, (v: T) => void] {
  const read = () => {
    try {
      const raw = localStorage.getItem(`pref:${key}`);
      return raw === null ? initial : (JSON.parse(raw) as T);
    } catch {
      return initial;
    }
  };
  const [value, setValue] = useState<T>(read);
  useEffect(() => {
    const on = (e: Event) => (e as CustomEvent<string>).detail === key && setValue(read());
    window.addEventListener('pref-changed', on);
    return () => window.removeEventListener('pref-changed', on);
  }, [key]);
  return [
    value,
    (v: T) => {
      try {
        localStorage.setItem(`pref:${key}`, JSON.stringify(v));
      } catch {
        // Storage full or blocked: the change holds for this screen only.
      }
      setValue(v);
      window.dispatchEvent(new CustomEvent('pref-changed', { detail: key }));
    },
  ];
}

/** True while a media query matches, e.g. a window wide enough for the Context panel. */
export function useMediaQuery(query: string) {
  const [match, setMatch] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const on = () => setMatch(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, [query]);
  return match;
}

/** A key pressed outside a text field, list or dialog that takes its own keys. Shift is allowed, so "?" works. */
export function isPlainKey(e: KeyboardEvent) {
  const t = e.target as HTMLElement;
  return !t.closest('input, textarea, select, [contenteditable], [role="dialog"], [role="alertdialog"], [role="listbox"], [role="menu"]');
}
