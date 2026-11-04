import { Check, Eye, GitMerge, MessageSquare, RefreshCw, Undo2, X, type LucideIcon } from 'lucide-react';
import { useState } from 'react';
import type { Go } from '../App.tsx';
import type { CheckItem, ReviewData, StackEntry } from '../../shared/types.ts';
import { cleanError } from './ui.tsx';
import { Notice } from './ui/Notice.tsx';
import { Pill } from './ui/Pill.tsx';
import { SectionHeader } from './ui/SectionHeader.tsx';
import type { PillTone } from './ui/buttonStyles.ts';

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

/** The pill tone for a set of checks: failing is an error, all passed is ok, anything still running is neutral. */
export const checksTone = (checks: CheckItem[]): PillTone => {
  const n = checkCounts(checks);
  return n.fail ? 'error' : n.pending ? 'default' : 'ok';
};

/** "PR #12 ↗" in a review's header, opening the pull request on GitHub. Nothing for a branch without a PR. */
export function PrLink({ data }: { data: ReviewData }) {
  if (!data.pr) return null;
  const { url, number } = data.pr;
  return (
    <Pill tone="muted" onClick={() => window.api.openExternal(url)} data-tooltip="Open on GitHub">
      PR #{number} ↗
    </Pill>
  );
}

const DOT = { pass: 'bg-ok', fail: 'bg-error', pending: 'bg-faint', skipped: 'bg-faint' } as const;
const TEXT = { error: 'text-error', ok: 'text-ok', default: 'text-text' } as Record<PillTone, string>;

/** CI on the pull request, in the Context panel: a summary, with the checks that need a look listed. */
export function ChecksCard({ data }: { data: ReviewData }) {
  const [all, setAll] = useState(false);
  const checks = data.pr?.checks ?? [];
  if (!data.pr) return null;
  const notable = checks.filter((c) => c.state === 'fail' || c.state === 'pending');
  const list = all ? checks : notable;
  return (
    <section className="flex flex-col gap-1.5">
      <SectionHeader as="h3">CI on GitHub</SectionHeader>
      {!checks.length ? (
        <p className="text-ui text-muted">No checks ran on this pull request.</p>
      ) : (
        <>
          <p className={`text-ui font-semibold ${TEXT[checksTone(checks)]}`}>{checksText(checks)}</p>
          {list.map((c, i) => (
            <div key={i} className="flex items-center gap-2 text-ui">
              <span aria-hidden className={`size-2 shrink-0 rounded-full ${DOT[c.state]}`} />
              {c.url ? (
                <button type="button" className="text-left break-words text-link hover:underline" onClick={() => window.api.openExternal(c.url!)}>
                  {c.name} ↗
                </button>
              ) : (
                <span className="break-words">{c.name}</span>
              )}
            </div>
          ))}
          {checks.length > notable.length && (
            <button type="button" className="self-start text-meta text-link hover:underline" onClick={() => setAll(!all)}>
              {all ? 'Only what needs a look' : `Show all ${checks.length} checks`}
            </button>
          )}
        </>
      )}
    </section>
  );
}

/**
 * Where you are with a PR in a stack: your review in Hunkdory first, then what you did on GitHub. `done` is for
 * picking what to review next. Null: you haven't looked at it.
 */
export function stackStatus(e: StackEntry): { label: string; tone: PillTone; icon: LucideIcon; done: boolean } | null {
  if (e.status === 'merged') return { label: 'Merged', tone: 'ok', icon: GitMerge, done: true };
  if (e.status === 'discarded') return { label: 'Closed', tone: 'muted', icon: X, done: true };
  if ((e.status === 'reviewed' || e.status === 'sent-back') && e.changed) return { label: 'Changed since your review', tone: 'warn', icon: RefreshCw, done: false };
  if (e.status === 'reviewed') return { label: 'Reviewed', tone: 'ok', icon: Check, done: true };
  if (e.status === 'sent-back') return { label: 'Sent back', tone: 'caution', icon: Undo2, done: true };
  if (e.github === 'APPROVED') return { label: 'Approved', tone: 'ok', icon: Check, done: true };
  if (e.github === 'CHANGES_REQUESTED') return { label: 'Changes requested', tone: 'caution', icon: MessageSquare, done: true };
  if (e.github === 'COMMENTED') return { label: 'Commented', tone: 'link', icon: MessageSquare, done: false };
  if (e.status === 'open') return { label: 'In review', tone: 'link', icon: Eye, done: false };
  return null;
}

/** "3 of 8 reviewed": the PRs you're done with, this one included. */
export const stackProgress = (prs: StackEntry[]) => `${prs.filter((e) => stackStatus(e)?.done).length} of ${prs.length} reviewed`;

/** The PR to review after this one: the first one up the stack you're not done with, else the first one below. */
export function nextInStack(prs: StackEntry[]): StackEntry | null {
  const at = prs.findIndex((e) => e.current);
  const todo = (e: StackEntry) => !e.current && !stackStatus(e)?.done;
  return prs.slice(at + 1).find(todo) ?? prs.slice(0, at).find(todo) ?? null;
}

/** Opens a PR of the stack. One outside your inbox gets picked, the same as "Review another branch". */
export async function openStackEntry(projectId: string, e: StackEntry, go: Go) {
  await window.api.trackBranch(projectId, e.branch);
  go({ name: 'plan', projectId, branch: e.branch });
}

/** The PRs this one sits on and that sit on it. Each opens its own review. */
export function StackBar({ data, go }: { data: ReviewData; go: Go }) {
  const [error, setError] = useState<string | null>(null);
  if (!data.stack) return null;
  const open = async (e: StackEntry) => {
    try {
      await openStackEntry(data.projectId, e, go);
    } catch (err) {
      setError(cleanError(err));
    }
  };
  return (
    <nav aria-label="Pull request stack" className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-ui">
        <span className="font-semibold text-muted">Stack</span>
        <span className="font-mono text-muted">{data.stack.base}</span>
        {data.stack.prs.map((e) => (
          <span key={e.number} className="inline-flex items-center gap-2">
            <span aria-hidden className="text-faint">
              ←
            </span>
            {e.current ? (
              <Pill selected aria-current="page" data-tooltip={e.title}>
                #{e.number} this PR
              </Pill>
            ) : (
              <StackPill entry={e} onClick={() => open(e)} />
            )}
          </span>
        ))}
      </div>
      <span className="text-meta text-muted">This review only shows what this PR adds on top of the one below it. {stackProgress(data.stack.prs)}.</span>
      {error && <Notice tone="error">{error}</Notice>}
    </nav>
  );
}

function StackPill({ entry: e, onClick }: { entry: StackEntry; onClick(): void }) {
  const st = stackStatus(e);
  return (
    <Pill tone={st?.tone ?? 'muted'} icon={st && <st.icon size={12} strokeWidth={2.5} aria-hidden />} onClick={onClick} data-tooltip={`${e.title}${st ? ` · ${st.label}` : ' · Not reviewed yet'}`}>
      #{e.number}
      {st ? ` · ${st.label}` : ''}
    </Pill>
  );
}
