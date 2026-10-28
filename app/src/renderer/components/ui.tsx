import { useEffect, useState, type ReactNode } from 'react';
import type { RiskLevel } from '../../shared/types.ts';
import { RISK_LABEL } from '../../shared/order.ts';

export function Logo({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
      <path d="M8 11l2 2 4-4" />
    </svg>
  );
}

export function Brand({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="brand" onClick={onClick}>
      <Logo />
      <span>Reviewer</span>
    </button>
  );
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
        {detail && <span className="mono" style={{ fontSize: 13, color: 'var(--muted)' }}>{detail}</span>}
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
