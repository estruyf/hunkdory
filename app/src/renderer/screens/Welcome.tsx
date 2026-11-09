import { FolderOpen, Lock } from 'lucide-react';
import type { Go } from '../App.tsx';
import { Logo } from '../components/ui.tsx';
import { VersionLine } from '../components/feedback.tsx';
import { FoundOnThisMac } from '../components/found.tsx';
import { SetupChecklist, WhatYouCanReview, useSetup } from '../components/setup.tsx';
import { Button } from '../components/ui/Button.tsx';
import { currentPlatform, yourComputer } from '../lib/platform.ts';

/** First run: what this is, what it can review, whether your tools are ready, and the repos you already work in. */
export function Welcome({ go }: { go: Go }) {
  const setup = useSetup();
  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <header className={`drag flex h-10 shrink-0 items-center gap-2 pr-4 ${currentPlatform() === 'darwin' ? 'pl-24' : 'pl-4'}`}>
        <Logo />
        <span className="text-body font-semibold">Hunkdory</span>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 pt-10 pb-14">
          <div className="flex flex-col gap-2">
            <h1 className="text-hero font-semibold">Understand every change before you approve it.</h1>
            <p className="text-body text-muted">
              Hunkdory tells a change as a story: what was asked, what it does, and each part explained in plain words. Ask your assistant about anything that isn't clear, have it make a change, then merge it or send it back.
            </p>
          </div>

          <WhatYouCanReview />
          <SetupChecklist setup={setup} />

          <FoundOnThisMac onPick={(path) => go({ name: 'connect', path })} title="Pick a repo to start with" />

          <div>
            <Button icon={<FolderOpen size={14} aria-hidden />} onClick={() => go({ name: 'connect' })}>
              Choose another folder…
            </Button>
          </div>

          <p className="flex items-center gap-2 text-meta text-faint">
            <Lock size={13} aria-hidden />
            Hunkdory runs on {yourComputer()}. Your code only goes to your assistant when you let it write a walkthrough, answer a question, make a change, run an AI review, or take work back.
          </p>
          <VersionLine />
        </div>
      </div>
    </div>
  );
}
