import { Loader2 } from 'lucide-react';
import { useId, useEffect, useRef, useState, type ReactNode } from 'react';
import type { ReviewerApi, ReviewState, RiskLevel } from '../../shared/types.ts';
import type { Go } from '../App.tsx';
import { RISK_LABEL } from '../../shared/order.ts';
import { Pill } from './ui/Pill.tsx';

/**
 * The Hunkdory app icon (resources/icon.svg): diff lines and a check on a dark tile. Without its shadows and highlights,
 * which don't show at the size it's drawn here. The ids are per instance: a duplicate in a hidden tab would leave the others without colour.
 */
export function Logo({ size = 20 }: { size?: number }) {
  const id = useId();
  return (
    <svg width={size} height={size} viewBox="100 100 824 824" aria-hidden="true" className="shrink-0">
      <defs>
        <linearGradient id={`${id}body`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#34363f" />
          <stop offset="1" stopColor="#17181d" />
        </linearGradient>
        <linearGradient id={`${id}ring`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2a2c33" />
          <stop offset="1" stopColor="#4a4d58" />
        </linearGradient>
        <linearGradient id={`${id}gold`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffd27a" />
          <stop offset="1" stopColor="#e09a2c" />
        </linearGradient>
        <linearGradient id={`${id}warm`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f3a27f" />
          <stop offset="1" stopColor="#c95f3d" />
        </linearGradient>
        <linearGradient id={`${id}green`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#9be3a5" />
          <stop offset="1" stopColor="#3fa957" />
        </linearGradient>
      </defs>
      <rect x="100" y="100" width="824" height="824" rx="185" fill={`url(#${id}body)`} />
      <rect x="236" y="256" width="440" height="88" rx="44" fill={`url(#${id}ring)`} />
      <rect x="254" y="274" width="404" height="52" rx="26" fill={`url(#${id}warm)`} />
      <rect x="236" y="392" width="552" height="88" rx="44" fill={`url(#${id}ring)`} />
      <rect x="254" y="410" width="516" height="52" rx="26" fill={`url(#${id}warm)`} />
      <rect x="236" y="528" width="264" height="88" rx="44" fill={`url(#${id}ring)`} />
      <rect x="254" y="546" width="228" height="52" rx="26" fill={`url(#${id}green)`} />
      <polyline points="540,690 636,786 812,566" fill="none" stroke={`url(#${id}gold)`} strokeWidth="76" strokeLinecap="round" strokeLinejoin="round" />
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
type InboxOpts = NonNullable<Parameters<ReviewerApi['inbox']>[0]>;

// The inbox as last seen, from the last run until the first scan is in. A scan takes seconds, so the inbox shows this while a new one runs.
let lastInbox: Inbox | undefined;
const inboxListeners = new Set<(v: Inbox) => void>();

/** A branch as the inbox last listed it, for before it's been read. */
export const knownInboxItem = (projectId: string, branch: string) => lastInbox?.waiting.find((w) => w.projectId === projectId && w.branch === branch) ?? null;

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
  // `projectId`: the scan reads only that project.
  const [state, setState] = useState<{ error?: string; loading: boolean; projectId?: string }>({ loading: true });
  const [tick, setTick] = useState(0);
  const next = useRef<InboxOpts>({});
  useEffect(() => {
    inboxListeners.add(setValue);
    if (!lastInbox) void window.api.inboxCached().then((v) => v && !lastInbox && setLastInbox(v));
    return () => void inboxListeners.delete(setValue);
  }, []);
  useEffect(() => {
    let live = true;
    const opts = next.current;
    next.current = {};
    setState({ loading: true, projectId: opts.projectId });
    window.api.inbox(opts).then(
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
    reload: (opts: InboxOpts = {}) => {
      next.current = opts;
      setTick((t) => t + 1);
    },
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
