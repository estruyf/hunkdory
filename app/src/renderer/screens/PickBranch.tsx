import { Search } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { Go } from '../App.tsx';
import { Crumbs, Loading, cleanError, plural, useAsync } from '../components/ui.tsx';
import { ViewHeader } from '../components/ViewHeader.tsx';
import { Button } from '../components/ui/Button.tsx';
import { Kbd } from '../components/ui/Kbd.tsx';
import { Notice } from '../components/ui/Notice.tsx';
import { Pill } from '../components/ui/Pill.tsx';
import { SectionHeader } from '../components/ui/SectionHeader.tsx';
import { Select } from '../components/ui/Select.tsx';
import { FIELD_LG } from '../components/ui/field.ts';
import { matches } from '../lib/shortcuts.ts';
import { useTabActive } from '../state/tabPane.ts';
import { timeAgo } from '../../shared/order.ts';

/** Review any branch: yours, a colleague's, or one an agent made without a session. */
export function PickBranch({ go, initialProject }: { go: Go; initialProject?: string }) {
  const projects = useAsync(() => window.api.listProjects(), []);
  const [projectId, setProjectId] = useState(initialProject);
  const current = projectId ?? projects.value?.[0]?.id;
  // Wait for the project list, or an empty list flashes up as "no branches".
  const branches = useAsync(() => (current ? window.api.listBranches(current) : new Promise<never>(() => { })), [current]);
  const uncommitted = useAsync(() => (current ? window.api.listUncommitted(current) : new Promise<never>(() => { })), [current]);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null);
  const project = projects.value?.find((p) => p.id === current);

  const q = query.trim().toLowerCase();
  const list = (branches.value ?? []).filter((b) => !q || `${b.name} ${b.author} ${b.subject}`.toLowerCase().includes(q));

  // ⌘F finds a branch.
  const onScreen = useTabActive();
  useEffect(() => {
    if (!onScreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (!matches(e, 'pick.find')) return;
      e.preventDefault();
      field.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onScreen]);

  const pickUncommitted = async (name: string) => {
    try {
      await window.api.reviewUncommitted(current!, name);
      go({ name: 'plan', projectId: current!, branch: name });
    } catch (e) {
      setError(cleanError(e));
    }
  };

  const pick = async (name: string) => {
    try {
      await window.api.trackBranch(current!, name);
      go({ name: 'plan', projectId: current!, branch: name });
    } catch (e) {
      setError(cleanError(e));
    }
  };

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <ViewHeader>
        <div className="min-w-0 flex-1">
          <Crumbs items={[{ label: 'Review another branch' }]} />
        </div>
      </ViewHeader>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-6 pt-7 pb-14">
          <div className="flex flex-col gap-1.5">
            <h1 className="text-hero font-semibold">Review another branch</h1>
            <p className="text-body text-muted">
              Any branch with commits on top of {project ? <span className="font-mono">{project.baseBranch}</span> : 'its main branch'}: yours, a colleague's, or an agent's. Or just the uncommitted changes in a folder. Remote branches are as fresh as your last fetch.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {(projects.value?.length ?? 0) > 1 && (
              <Select label="Project" value={current ?? ''} onChange={setProjectId} options={projects.value!.map((p) => ({ value: p.id, label: p.name }))} className={`${FIELD_LG} w-48`} />
            )}
            <label className={`${FIELD_LG} flex min-w-0 flex-[1_1_320px] items-center gap-2 focus-within:border-accent-ink`}>
              <Search size={13} className="text-faint" aria-hidden />
              <input ref={field} autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search branch, author or commit message" aria-label="Search branches" className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-faint" />
              <Kbd shortcut="pick.find" />
            </label>
          </div>
          {error && <Notice tone="error">{error}</Notice>}
          {!!uncommitted.value?.length && (
            <section className="flex flex-col gap-1.5">
              <SectionHeader as="h2">Uncommitted changes</SectionHeader>
              <p className="m-0 text-meta text-muted">Edits in a folder that aren't committed yet. Review just those, against the branch's last commit.</p>
              <ul className="m-0 flex list-none flex-col gap-px p-0">
                {uncommitted.value.map((u) => (
                  <li key={u.path} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg px-2.5 py-2 hover:bg-border/45">
                    <div className="flex min-w-0 flex-[1_1_420px] flex-col gap-0.5">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="truncate text-ui font-semibold">
                          Uncommitted on <span className="font-mono">{u.branch}</span>
                        </span>
                        <Pill tone="muted">{u.where === 'main' ? 'main folder' : 'worktree'}</Pill>
                        {u.inInbox && <Pill tone="muted">In your inbox</Pill>}
                      </span>
                      <span className="truncate text-meta text-faint">
                        {plural(u.files, 'file')} not committed · {u.path}
                      </span>
                    </div>
                    {u.inInbox ? <Button onClick={() => go({ name: 'plan', projectId: current!, branch: u.branch })}>Open</Button> : <Button onClick={() => pickUncommitted(u.branch)}>Review changes</Button>}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {!!uncommitted.value?.length && <SectionHeader as="h2">Branches</SectionHeader>}
          {branches.loading && <Loading label="Listing branches…" />}
          {branches.error && <Notice tone="error">{branches.error}</Notice>}
          {branches.value && !branches.loading && (
            <ul className="m-0 flex list-none flex-col gap-px p-0">
              {list.length === 0 && <Notice>No branches with changes on top of the base.</Notice>}
              {list.map((b) => (
                <li key={b.name} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg px-2.5 py-2 hover:bg-border/45">
                  <div className="flex min-w-0 flex-[1_1_420px] flex-col gap-0.5">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate font-mono text-ui font-semibold">{b.name}</span>
                      {b.remote && <Pill tone="muted">remote</Pill>}
                      {b.inInbox && <Pill tone="muted">In your inbox</Pill>}
                    </span>
                    <span className="truncate text-meta text-faint">
                      {b.author} · {timeAgo(b.updatedAt)} · {plural(b.ahead, 'commit')} · {b.subject}
                    </span>
                  </div>
                  {b.inInbox ? <Button onClick={() => go({ name: 'plan', projectId: current!, branch: b.name })}>Open</Button> : <Button onClick={() => pick(b.name)}>Review</Button>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
