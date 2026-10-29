import { useEffect, useState, type ReactNode } from 'react';
import type { ReviewerApi, ReviewState, RiskLevel } from '../../shared/types.ts';
import type { Go } from '../App.tsx';
import { RISK_LABEL } from '../../shared/order.ts';

/** The Hunkdory app icon: three diff lines and a check on a blue tile. */
export function Logo({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="100 100 824 824" aria-hidden="true">
      <rect x="100" y="100" width="824" height="824" rx="185" fill="#3451d1" />
      <rect x="232" y="290" width="300" height="80" rx="40" fill="#FF8E85" />
      <rect x="232" y="412" width="470" height="80" rx="40" fill="#7BE3A6" />
      <rect x="232" y="534" width="390" height="80" rx="40" fill="#7BE3A6" />
      <rect x="232" y="656" width="230" height="80" rx="40" fill="#fff" fillOpacity="0.28" />
      <path d="M548 700 L642 794 L812 594" fill="none" stroke="#fff" strokeWidth="80" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** The gear on project settings and on the app's own Settings. */
export function GearIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </svg>
  );
}

/** The logo and name at the left of every top bar. Without `onClick` (on Welcome) there's nowhere to go back to. */
export function Brand({ onClick }: { onClick?: () => void }) {
  const inner = (
    <>
      <Logo />
      <span>Hunkdory</span>
    </>
  );
  if (!onClick) return <span className="brand" style={{ cursor: 'default' }}>{inner}</span>;
  return (
    <button type="button" className="brand" onClick={onClick}>
      {inner}
    </button>
  );
}

export interface Crumb {
  label: string;
  onClick?: () => void;
  /** Long labels, like a review's title, give way first when space runs out. */
  shrink?: boolean;
}

/** Where you are. Every part but the last takes you there. */
export function Crumbs({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" style={{ minWidth: 0, overflow: 'hidden' }}>
      <ol className="crumbs">
        {items.map((c, i) => {
          const last = i === items.length - 1;
          return (
            // The long crumb gives way first but keeps a few letters; then the others; where you are never does.
            <li key={i} style={{ flex: `0 ${c.shrink ? 1 : last ? 0 : 0.001} auto`, minWidth: c.shrink ? '4em' : 0 }}>
              {i > 0 && <span aria-hidden="true" className="crumb-sep">›</span>}
              {c.onClick && !last ? (
                <button type="button" className="crumb" title={c.label} onClick={c.onClick}>
                  {c.label}
                </button>
              ) : (
                <span className={`crumb ${last ? 'here' : ''}`} title={c.label} aria-current={last ? 'page' : undefined}>
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

/** The first crumbs of every review screen: the inbox, then the project's own inbox. */
export const reviewCrumbs = (go: Go, data: { projectId: string; projectName: string }): Crumb[] => [
  { label: 'Inbox', onClick: () => go({ name: 'home' }) },
  { label: renamed.get(data.projectId) ?? data.projectName, onClick: () => go({ name: 'home', projectId: data.projectId }) },
];

// Projects renamed while the app runs. Screens you go back to may hold review data from before.
const renamed = new Map<string, string>();

/** A project got a new name: show it on the remembered inbox and in review crumbs before anything reloads. */
export function rememberProjectName(projectId: string, name: string) {
  renamed.set(projectId, name);
  const v = lastInbox;
  if (v) setLastInbox({ ...v, waiting: v.waiting.map((w) => (w.projectId === projectId ? { ...w, projectName: name } : w)) });
}

export function RiskPill({ risk }: { risk: RiskLevel }) {
  return <span className={`pill ${risk}`}>{RISK_LABEL[risk]}</span>;
}

export const Later = () => <span className="later">Later</span>;

export function Loading({ label }: { label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '24px 0', color: 'var(--muted)', fontSize: 14 }}>
      <span className="spinner" /> {label}
    </div>
  );
}

/**
 * Full-page loading state that keeps the app's frame, so opening a branch doesn't flash a bare
 * spinner. It stays invisible for the first moments; most loads finish before it shows.
 */
export function LoadingPage({ onHome, label, detail }: { onHome: () => void; label: string; detail?: string }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 200);
    return () => clearTimeout(t);
  }, []);
  return (
    <div className="page">
      <header className="topbar">
        <Brand onClick={onHome} />
        {detail && <span className="mono topbar-sub" style={{ fontSize: 13 }}>{detail}</span>}
      </header>
      <div role="status" aria-live="polite" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', paddingBottom: '12vh', opacity: visible ? 1 : 0, transition: 'opacity .2s' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 15, color: 'var(--muted)' }}>
          <span className="spinner" style={{ width: 18, height: 18 }} />
          {label}
        </div>
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

export function Stat({ value, label, tone }: { value: ReactNode; label: string; tone?: 'warn' }) {
  return (
    <div className="card" style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 24, fontWeight: 700, color: tone === 'warn' ? 'var(--med-fg)' : undefined }}>{value}</span>
      <span style={{ fontSize: 13, color: 'var(--muted)' }}>{label}</span>
    </div>
  );
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
export const sizeText = (files: number, added: number, removed: number) => `${plural(files, 'file')} · +${added} −${removed}`;

/** A setting that sticks between reviews, like the diff layout. Kept in this window's local storage. */
export function usePref<T extends string | boolean>(key: string, initial: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    const raw = localStorage.getItem(`pref:${key}`);
    return raw === null ? initial : (JSON.parse(raw) as T);
  });
  return [
    value,
    (v: T) => {
      localStorage.setItem(`pref:${key}`, JSON.stringify(v));
      setValue(v);
    },
  ];
}
