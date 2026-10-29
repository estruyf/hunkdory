import { useState } from 'react';
import type { Go } from '../App.tsx';
import type { CheckItem, ReviewData, StackEntry } from '../../shared/types.ts';
import { cleanError } from './ui.tsx';

export function checkCounts(checks: CheckItem[]) {
  const n = { pass: 0, fail: 0, pending: 0, skipped: 0 };
  for (const c of checks) n[c.state]++;
  return n;
}

/** "2 failing · 5 passed", worst first. Empty when there are no checks. */
export function checksText(checks: CheckItem[]): string {
  const n = checkCounts(checks);
  return [n.fail && `${n.fail} failing`, n.pending && `${n.pending} running`, n.pass && `${n.pass} passed`, n.skipped && `${n.skipped} skipped`].filter(Boolean).join(' · ');
}

export const checksTone = (checks: CheckItem[]) => {
  const n = checkCounts(checks);
  return n.fail ? 'high' : n.pending ? 'medium' : 'low';
};

const DOT = { pass: 'var(--low-fg)', fail: 'var(--high-fg)', pending: 'var(--med-fg)', skipped: 'var(--muted)' } as const;

/** CI on the pull request: a summary, with the checks that need a look listed. */
export function ChecksCard({ data }: { data: ReviewData }) {
  const [all, setAll] = useState(false);
  const checks = data.pr?.checks ?? [];
  if (!data.pr) return null;
  const notable = checks.filter((c) => c.state === 'fail' || c.state === 'pending');
  const list = all ? checks : notable;
  return (
    <section className="card" style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <h2 className="label">CI on GitHub</h2>
      {!checks.length ? (
        <p style={{ fontSize: 14, color: 'var(--muted)' }}>No checks ran on this pull request.</p>
      ) : (
        <>
          <p style={{ fontSize: 14, fontWeight: 600, color: `var(--${checksTone(checks) === 'high' ? 'high' : checksTone(checks) === 'medium' ? 'med' : 'low'}-fg)` }}>{checksText(checks)}</p>
          {list.map((c, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13.5 }}>
              <span style={{ flex: 'none', width: 8, height: 8, borderRadius: 999, background: DOT[c.state] }} />
              {c.url ? (
                <button type="button" className="link" style={{ fontSize: 13.5, textAlign: 'left', overflowWrap: 'anywhere' }} onClick={() => window.api.openExternal(c.url!)}>
                  {c.name} ↗
                </button>
              ) : (
                <span style={{ overflowWrap: 'anywhere' }}>{c.name}</span>
              )}
            </div>
          ))}
          {checks.length > notable.length && (
            <button type="button" className="link" style={{ fontSize: 13, fontWeight: 500, textAlign: 'left' }} onClick={() => setAll(!all)}>
              {all ? 'Only what needs a look' : `Show all ${checks.length} checks`}
            </button>
          )}
        </>
      )}
    </section>
  );
}

const STATUS: Record<NonNullable<StackEntry['status']>, string> = { open: 'In review', reviewed: 'Reviewed', 'sent-back': 'Sent back', merged: 'Merged', discarded: 'Closed' };

/** The PRs this one sits on and that sit on it. Each opens its own review. */
export function StackBar({ data, go }: { data: ReviewData; go: Go }) {
  const [error, setError] = useState<string | null>(null);
  if (!data.stack) return null;
  const open = async (e: StackEntry) => {
    try {
      // A PR outside your inbox gets picked, the same as "Review another branch".
      await window.api.trackBranch(data.projectId, e.branch);
      go({ name: 'plan', projectId: data.projectId, branch: e.branch });
    } catch (err) {
      setError(cleanError(err));
    }
  };
  return (
    <nav aria-label="Pull request stack" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 8px', fontSize: 13 }}>
        <span style={{ fontWeight: 600, color: 'var(--muted)' }}>Stack</span>
        <span className="mono" style={{ color: 'var(--muted)' }}>
          {data.stack.base}
        </span>
        {data.stack.prs.map((e) => (
          <span key={e.number} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <span aria-hidden="true" style={{ color: 'var(--muted)' }}>
              ←
            </span>
            {e.current ? (
              <span className="pill accent" style={{ border: 0 }} aria-current="page" title={e.title}>
                #{e.number} this PR
              </span>
            ) : (
              <button type="button" className="pill neutral" style={{ border: 0, cursor: 'pointer', font: 'inherit', fontSize: 12, fontWeight: 600 }} title={`${e.title}${e.status ? ` · ${STATUS[e.status]}` : ''}`} onClick={() => open(e)}>
                #{e.number}
                {e.status ? ` · ${STATUS[e.status]}` : ''}
              </button>
            )}
          </span>
        ))}
      </div>
      <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>This review only shows what this PR adds on top of the one below it.</span>
      {error && <p className="error">{error}</p>}
    </nav>
  );
}
