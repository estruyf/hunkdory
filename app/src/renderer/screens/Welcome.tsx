import { FolderOpen, Lock } from 'lucide-react';
import type { Go } from '../App.tsx';
import { Logo } from '../components/ui.tsx';
import { FoundOnThisMac } from '../components/found.tsx';
import { Button } from '../components/ui/Button.tsx';
import { currentPlatform } from '../lib/platform.ts';

/** First run: a focused view, the repos you already use with Claude Code are the way in. */
export function Welcome({ go }: { go: Go }) {
  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <header className={`drag flex h-13 shrink-0 items-center gap-2 pr-4 ${currentPlatform() === 'darwin' ? 'pl-24' : 'pl-4'}`}>
        <Logo />
        <span className="text-body font-semibold">Hunkdory</span>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 pt-12 pb-14">
          <div className="flex flex-col gap-2">
            <h1 className="text-hero font-semibold">Review what your agents wrote, one step at a time.</h1>
            <p className="text-body text-muted">
              Pick a repo. Hunkdory finds the branches your coding agents make, reads the session behind them and splits each change into steps you can follow. Every changed line belongs to a step, and anything you didn't ask
              for is called out.
            </p>
          </div>

          <FoundOnThisMac onPick={(path) => go({ name: 'connect', path })} title="You use Claude Code in these repos" />

          <div>
            <Button icon={<FolderOpen size={14} aria-hidden />} onClick={() => go({ name: 'connect' })}>
              Choose another folder…
            </Button>
          </div>

          <p className="flex items-center gap-2 text-meta text-faint">
            <Lock size={13} aria-hidden />
            Hunkdory runs on your Mac. It only sends code to Claude when you let it write a walkthrough, ask a question, or send work back.
          </p>
        </div>
      </div>
    </div>
  );
}
