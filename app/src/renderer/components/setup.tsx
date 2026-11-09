import { useEffect, useState, type ReactNode } from 'react';
import { CircleCheck, CircleAlert, CircleX, GitBranch, GitPullRequest, Pencil, RefreshCw } from 'lucide-react';
import { Button } from './ui/Button.tsx';
import { cleanError } from './ui.tsx';
import { Notice } from './ui/Notice.tsx';
import { INSTALL_URL } from '../../shared/assistantText.ts';
import type { SetupStatus } from '../../shared/types.ts';
import { currentPlatform, thisComputer } from '../lib/platform.ts';

/** What's installed and signed in, and a way to look again after you did something about it. */
export function useSetup() {
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const check = async (recheck: boolean) => {
    setChecking(true);
    setError(null);
    try {
      setStatus(await window.api.setupStatus({ recheck }));
    } catch (e) {
      setError(cleanError(e));
    }
    setChecking(false);
  };
  useEffect(() => {
    void check(false);
  }, []);
  return { status, checking, error, recheck: () => check(true) };
}

export function InstallLink({ id, children }: { id: string; children: ReactNode }) {
  return (
    <button type="button" className="text-link hover:underline" onClick={() => window.api.openExternal(INSTALL_URL[id]!)}>
      {children} ↗
    </button>
  );
}

function Tool({ state, name, children }: { state: 'ok' | 'optional' | 'missing'; name: string; children: ReactNode }) {
  const Icon = state === 'ok' ? CircleCheck : state === 'optional' ? CircleAlert : CircleX;
  return (
    <li className="flex items-start gap-2.5">
      <Icon size={15} className={`mt-0.5 shrink-0 ${state === 'ok' ? 'text-ok' : state === 'optional' ? 'text-caution' : 'text-error'}`} aria-label={state === 'ok' ? 'Ready' : state === 'optional' ? 'Not set up' : 'Missing'} />
      <span className="min-w-0 text-ui">
        <strong className="font-semibold">{name}.</strong> <span className="text-muted">{children}</span>
      </span>
    </li>
  );
}

/** First run: what Hunkdory found on this Mac, what each thing is for, and how to get what's missing. */
export function SetupChecklist({ setup }: { setup: ReturnType<typeof useSetup> }) {
  const { status, checking, error, recheck } = setup;
  const assistants = status?.assistants.filter((a) => a.available && a.id !== 'manual') ?? [];
  return (
    <section aria-label="Your tools" className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-3">
        <h2 className="flex-1 text-title font-semibold">Your tools</h2>
        <Button variant="quiet" size="sm" disabled={checking} aria-busy={checking} icon={<RefreshCw size={13} className={checking ? 'animate-spin' : ''} aria-hidden />} onClick={recheck}>
          Check again
        </Button>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      {!status && !error && <p className="text-ui text-muted">Looking at what's on {thisComputer()}…</p>}
      {status && (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          <Tool state={status.git ? 'ok' : 'missing'} name="Git">
            {status.git ? (
              'Hunkdory reads your branches with it.'
            ) : currentPlatform() === 'win32' ? (
              <>Hunkdory needs it to read your branches, and Claude Code needs its Git Bash. <InstallLink id="git">Install Git for Windows</InstallLink>.</>
            ) : (
              <>Hunkdory needs it to read your branches. Run <code className="font-mono">xcode-select --install</code> in a terminal.</>
            )}
          </Tool>
          <Tool state={assistants.length ? 'ok' : 'optional'} name={assistants.length ? assistants.map((a) => a.name).join(' and ') : 'An AI assistant'}>
            {assistants.length ? (
              'Tells each change as a story, answers your questions and makes the changes you ask for.'
            ) : (
              <>
                Tells each change as a story, answers your questions and makes the changes you ask for. Without one you get the plain changes, one step per file. Get <InstallLink id="claude-code">Claude Code</InstallLink> or the <InstallLink id="copilot">Copilot CLI</InstallLink>.
              </>
            )}
          </Tool>
          <Tool state={status.gh.signedIn ? 'ok' : 'optional'} name="GitHub CLI">
            {status.gh.signedIn ? (
              <>For pull requests. Signed in{status.gh.login ? ` as ${status.gh.login}` : ''}.</>
            ) : status.gh.installed ? (
              <>Needed for pull requests, not for branches. Run <code className="font-mono">gh auth login</code> in a terminal to sign in.</>
            ) : (
              <>Needed for pull requests, not for branches. <InstallLink id="gh">Install it</InstallLink>, then run <code className="font-mono">gh auth login</code>.</>
            )}
          </Tool>
        </ul>
      )}
    </section>
  );
}

/** The three kinds of work Hunkdory reviews, said once, up front, so you know they're all here. */
export function WhatYouCanReview() {
  const kinds = [
    { icon: GitBranch, title: 'Branches', detail: `What your coding agents or a colleague made, on ${thisComputer()}.` },
    { icon: GitPullRequest, title: 'Pull requests', detail: 'Every open PR on GitHub, including the ones Copilot opens.' },
    { icon: Pencil, title: 'Uncommitted changes', detail: 'Edits an agent left in your folder, before they’re committed.' },
  ];
  return (
    <section aria-label="What you can review" className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-2.5">
      {kinds.map((k) => (
        <div key={k.title} className="flex flex-col gap-1 rounded-xl border border-border p-3.5">
          <span className="flex items-center gap-2 text-body font-semibold">
            <k.icon size={15} className="shrink-0 text-accent-ink" aria-hidden />
            {k.title}
          </span>
          <span className="text-ui text-muted">{k.detail}</span>
        </div>
      ))}
    </section>
  );
}
