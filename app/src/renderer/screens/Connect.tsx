import { useEffect, useState } from 'react';
import type { Go, Route } from '../App.tsx';
import { Crumbs, cleanError, rememberProjectName } from '../components/ui.tsx';
import { ViewHeader } from '../components/ViewHeader.tsx';
import { Button } from '../components/ui/Button.tsx';
import { Checkbox } from '../components/ui/Checkbox.tsx';
import { Dialog } from '../components/ui/Dialog.tsx';
import { Notice } from '../components/ui/Notice.tsx';
import { Pill } from '../components/ui/Pill.tsx';
import { Radio, RadioGroup } from '../components/ui/Radio.tsx';
import { SectionHeader } from '../components/ui/SectionHeader.tsx';
import { Select } from '../components/ui/Select.tsx';
import { FIELD, FIELD_LG, TEXTAREA } from '../components/ui/field.ts';
import { Toggle } from '../components/ui/Toggle.tsx';
import { DEFAULT_AI_REVIEW, FINDING_LIMITS, REVIEW_AREAS, aiReviewSettings } from '../../shared/aiReview.ts';
import { matches } from '../lib/shortcuts.ts';
import { useTabActive } from '../state/tabPane.ts';
import { FoundOnThisMac } from '../components/found.tsx';
import type { AiReviewSettings, AssistantChoice, Project, RepoCheck, Watch } from '../../shared/types.ts';

/** Connect a new project, or change one you connected before (`projectId`). */
export function Connect({ go, initialPath, projectId, back }: { go: Go; initialPath?: string; projectId?: string; back: Route }) {
  const [existing, setExisting] = useState<Project | null>(null);
  const [path, setPath] = useState(initialPath ?? '');
  // null until you type: a new project takes the folder's name.
  const [name, setName] = useState<string | null>(null);
  const [check, setCheck] = useState<RepoCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [base, setBase] = useState('');
  const [anyBranch, setAnyBranch] = useState(true);
  const [usePattern, setUsePattern] = useState(false);
  const [pattern, setPattern] = useState('claude/*, copilot/*');
  const [pullRequests, setPullRequests] = useState(false);
  const [github, setGithub] = useState<string | null>(null);
  const [writeWalkthroughs, setWriteWalkthroughs] = useState<boolean | undefined>(undefined);
  const [assistants, setAssistants] = useState<AssistantChoice[]>([]);
  // null until the assistant list loaded, then a new project defaults to the first one installed.
  const [assistant, setAssistant] = useState<string | null>(null);
  const [aiReview, setAiReview] = useState<AiReviewSettings>(DEFAULT_AI_REVIEW);
  const [linking, setLinking] = useState(false);
  const [githubError, setGithubError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // New projects keep the details folded away: the defaults suit most repos.
  const [advanced, setAdvanced] = useState(!!projectId);
  const [removing, setRemoving] = useState(false);

  useEffect(() => {
    window.api.listAssistants().then((as) => {
      setAssistants(as);
      // A new project defaults to the first one installed: Claude Code, then Manual.
      setAssistant((a) => a ?? as.find((x) => x.available)?.id ?? as[0]?.id ?? 'claude-code');
    });
  }, []);

  // Editing: start from the saved settings.
  useEffect(() => {
    if (!projectId) return;
    window.api.listProjects().then((ps) => {
      const p = ps.find((x) => x.id === projectId);
      if (!p) return;
      setExisting(p);
      setName(p.name);
      setPath(p.path);
      setGithub(p.github ?? null);
      setWriteWalkthroughs(p.writeWalkthroughs);
      setAssistant(p.assistant ?? 'claude-code');
      setAiReview(aiReviewSettings(p.aiReview));
      setAnyBranch(p.watch.anyBranch);
      setUsePattern(p.watch.pattern !== null);
      if (p.watch.pattern) setPattern(p.watch.pattern);
      setPullRequests(p.watch.pullRequests);
    });
  }, [projectId]);

  useEffect(() => {
    if (!path.trim()) {
      setCheck(null);
      return;
    }
    let live = true;
    setChecking(true);
    const t = setTimeout(async () => {
      const c = await window.api.checkFolder(path.trim());
      if (!live) return;
      setCheck(c);
      setBase((b) => (existing ? existing.baseBranch : c.baseBranch ?? b));
      setChecking(false);
    }, 300);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [path, existing]);

  const choose = async () => {
    const p = await window.api.chooseFolder();
    if (p) setPath(p);
  };

  const toggleGithub = async (on: boolean) => {
    setGithubError(null);
    if (!on) {
      setGithub(null);
      setPullRequests(false);
      return;
    }
    setLinking(true);
    try {
      setGithub(await window.api.checkGitHub(check!.root!));
    } catch (e) {
      setGithubError(cleanError(e));
    }
    setLinking(false);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    const w: Watch = { anyBranch, pattern: usePattern ? pattern : null, pullRequests };
    const assistantInput = assistant ?? 'claude-code';
    try {
      if (existing) {
        const saved = await window.api.updateProject(existing.id, { name: name ?? existing.name, baseBranch: base, watch: w, github, writeWalkthroughs, assistant: assistantInput, aiReview });
        rememberProjectName(saved.id, saved.name);
      } else await window.api.addProject({ path: check!.root!, name: name ?? folderName, baseBranch: base, watch: w, github, writeWalkthroughs, assistant: assistantInput, aiReview });
      go({ name: 'home' });
    } catch (e) {
      setError(cleanError(e));
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!existing) return;
    await window.api.removeProject(existing.id);
    go({ name: 'home' });
  };

  const ok = !!check?.isRepo;
  // What an empty Name falls back to, like the main process does.
  const folderName = (check?.root ?? existing?.path ?? path).replace(/\/+$/, '').split('/').pop() ?? '';
  const onGitHub = !!check?.remote?.startsWith('github.com/');
  const baseOptions = check ? [...new Set([base, check.baseBranch, ...check.branches].filter(Boolean) as string[])] : [];

  // Say why Connect is greyed out, instead of leaving you to guess.
  const blocked = !ok
    ? 'Pick a folder with a git repo.'
    : !base
      ? 'Choose a base branch.'
      : usePattern && !pattern.trim()
        ? 'Fill in a branch pattern, or turn the pattern off.'
        : !anyBranch && !usePattern && !pullRequests
          ? 'Pick at least one thing to watch, under What needs a review.'
          : null;

  // ⌘↵ connects the project or saves its settings.
  const onScreen = useTabActive();
  useEffect(() => {
    if (!onScreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (!matches(e, 'connect.save') || blocked || saving) return;
      e.preventDefault();
      void save();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <ViewHeader>
        <div className="min-w-0 flex-1">
          <Crumbs items={existing ? [{ label: existing.name, onClick: () => go({ name: 'home', projectId: existing.id }) }, { label: 'Settings' }] : [{ label: 'Connect a project' }]} />
        </div>
      </ViewHeader>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-6 pt-7 pb-14">
          <div className="flex flex-col gap-1.5">
            <h1 className="text-hero font-semibold">{existing ? `${existing.name} settings` : 'Connect a project'}</h1>
            <p className="text-body text-muted">A project is one git repo on your Mac. The defaults suit most repos: pick the folder, choose how steps get written, and connect.</p>
          </div>

          {/* Adding a project: the repos you work in with Claude Code, one click from filling in the folder. */}
          {!projectId && !path.trim() && <FoundOnThisMac onPick={setPath} primary={false} />}

          <Section title="Repository">
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor="folder" className="w-full text-ui font-semibold">
                Folder
              </label>
              <input id="folder" className={`${FIELD_LG} min-w-0 flex-[1_1_300px] font-mono ${existing ? 'bg-sidebar' : ''}`} value={path} readOnly={!!existing} onChange={(e) => setPath(e.target.value)} placeholder="~/dev/my-project" />
              {!existing && (
                <Button size="lg" onClick={choose}>
                  Choose…
                </Button>
              )}
            </div>
            <div className="grid grid-cols-4 gap-2">
              <Tile label="Git repo">
                {checking ? <span className="text-muted">Checking…</span> : !check ? <span className="text-muted">Pick a folder</span> : ok ? <span className="text-ok">Detected ✓</span> : <span className="text-error">{check.error}</span>}
              </Tile>
              <Tile label="Base branch">
                {ok ? (
                  <Select label="Base branch" value={base} onChange={setBase} placeholder="Choose…" options={baseOptions.map((b) => ({ value: b, label: b }))} className="max-w-full font-mono text-ui font-semibold" />
                ) : (
                  <span className="text-muted">–</span>
                )}
              </Tile>
              <Tile label="Claude Code sessions">{ok ? <span className={check!.sessionCount ? 'text-ok' : 'text-muted'}>{check!.sessionCount ? `${check!.sessionCount} found` : 'None yet'}</span> : <span className="text-muted">–</span>}</Tile>
              <Tile label="Remote">
                <span className="font-mono text-meta break-all">{check?.remote ?? '–'}</span>
              </Tile>
            </div>
            {ok && !check!.sessionCount && <p className="text-meta text-muted">No sessions yet in ~/.claude or any ~/.claude-* folder. Reviews still work, with less context: no prompt and no agent reasons.</p>}
          </Section>

          <Section title="Who does the work?">
            <RadioGroup label="Assistant" className="flex flex-col gap-2">
              {assistants.map((a) => (
                <div key={a.id} className={`rounded-xl border p-3.5 ${assistant === a.id ? 'border-edge bg-card shadow-[inset_3px_0_0_var(--sb-text)]' : 'border-border'} ${a.available ? '' : 'opacity-60'}`}>
                  <Radio
                    checked={assistant === a.id}
                    disabled={!a.available}
                    tabbable={assistant === a.id}
                    onSelect={() => {
                      setAssistant(a.id);
                      // ACP agents aren't isolated the way Claude Code and Copilot's runs are: default auto-writing off rather than asking.
                      if (a.id.startsWith('acp:') && writeWalkthroughs === undefined) setWriteWalkthroughs(false);
                    }}
                  >
                    <span className="flex flex-col gap-0.5">
                      <span className="text-body font-semibold">{a.name}</span>
                      <span className="text-ui text-muted">
                        {!a.available ? a.reason : a.id === 'manual' ? "No AI. Hunkdory never sends this project's code anywhere." : 'Writes walkthroughs, answers questions on a step and makes changes you ask for.'}
                      </span>
                    </span>
                  </Radio>
                </div>
              ))}
            </RadioGroup>
            {assistant?.startsWith('acp:') && (
              <Notice tone="info">Unlike Claude Code and Copilot, Hunkdory can't stop this agent from loading the repo's own config (an AGENTS.md, its MCP servers, …) when it runs.</Notice>
            )}
          </Section>

          {assistant !== 'manual' && (
            <Section title="How should Hunkdory split changes into steps?">
              <RadioGroup label="Walkthroughs" className="flex flex-col gap-2">
                {[
                  {
                    on: true,
                    title: `Let ${assistants.find((a) => a.id === assistant)?.name ?? 'Claude'} write a walkthrough`,
                    note: assistant?.startsWith('acp:') ? '' : '(recommended)',
                    detail: `Steps by intent, with a reason for each. For a branch that opens without one, ${assistants.find((a) => a.id === assistant)?.name ?? 'Claude Code'} reads the diff, the commits and the session.${assistant === 'copilot' ? ' Like any Copilot run, that goes to GitHub.' : assistant === 'claude-code' ? ' Like any Claude Code run, that goes to Anthropic.' : ''
                      }`,
                  },
                  { on: false, title: 'One step per file, fully offline', note: '', detail: 'Nothing is sent anywhere. You can still ask for a walkthrough on a branch when you want one.' },
                ].map((o) => (
                  <div key={String(o.on)} className={`rounded-xl border p-3.5 ${writeWalkthroughs === o.on ? 'border-edge bg-card shadow-[inset_3px_0_0_var(--sb-text)]' : 'border-border'}`}>
                    <Radio checked={writeWalkthroughs === o.on} tabbable={writeWalkthroughs === o.on || (writeWalkthroughs === undefined && o.on)} onSelect={() => setWriteWalkthroughs(o.on)}>
                      <span className="flex flex-col gap-0.5">
                        <span className="text-body font-semibold">
                          {o.title} {o.note && <span className="font-normal text-muted">{o.note}</span>}
                        </span>
                        <span className="text-ui text-muted">{o.detail}</span>
                      </span>
                    </Radio>
                  </div>
                ))}
              </RadioGroup>
              {writeWalkthroughs === undefined && <p className="text-meta text-muted">Not chosen yet: Hunkdory asks the first time a branch opens without a walkthrough.</p>}
            </Section>
          )}

          {assistant !== 'manual' && (
            <Section title="AI review">
              <Toggle
                label="Offer an AI review on this project's branches"
                detail={`Adds a Run AI review button to each plan. ${assistants.find((a) => a.id === assistant)?.name ?? 'The assistant you picked above'} does the review, and only when you press it.`}
                checked={aiReview.enabled}
                attr="data-ai-review"
                onChange={(enabled) => setAiReview({ ...aiReview, enabled })}
              />
              {aiReview.enabled && (
                <>
                  <div className="flex flex-col gap-2">
                    <SectionHeader as="h3">What to check</SectionHeader>
                    {REVIEW_AREAS.map((a) => (
                      <div key={a.id} className="flex flex-col">
                        <Checkbox checked={aiReview.areas.includes(a.id)} onChange={(on) => setAiReview({ ...aiReview, areas: on ? [...aiReview.areas, a.id] : aiReview.areas.filter((x) => x !== a.id) })}>
                          {a.label}
                        </Checkbox>
                        <span className="pl-6 text-meta text-muted">{a.detail}</span>
                      </div>
                    ))}
                    {aiReview.areas.length === 0 && <span role="alert" className="text-meta text-error">Choose at least one, or turn AI review off.</span>}
                  </div>
                  <label className="flex flex-col gap-1 text-ui font-semibold">
                    Your own instructions (optional)
                    <textarea
                      rows={3}
                      className={`${TEXTAREA} font-normal`}
                      value={aiReview.instructions}
                      onChange={(e) => setAiReview({ ...aiReview, instructions: e.target.value })}
                      placeholder="e.g. We target WCAG 2.2 AA. Money is always in cents. Ignore files in src/legacy."
                    />
                    <span className="text-meta font-normal text-muted">Saved in Hunkdory on this Mac, not in the repo, so a branch can't change the rules of its own review.</span>
                  </label>
                  <div className="flex flex-col gap-1.5">
                    <SectionHeader as="h3">How deep</SectionHeader>
                    <RadioGroup label="How deep" className="flex flex-col gap-1.5">
                      {[
                        { value: 'quick' as const, title: 'Quick', detail: 'Reads the diff and little else. Faster and cheaper, but it can miss problems in how the code fits together.' },
                        { value: 'thorough' as const, title: 'Thorough', detail: "Also reads the code around the change. Slower, and it uses more of your assistant's usage." },
                      ].map((o) => (
                        <Radio key={o.value} checked={aiReview.depth === o.value} tabbable={aiReview.depth === o.value} onSelect={() => setAiReview({ ...aiReview, depth: o.value })}>
                          <span className="flex flex-col">
                            <span>{o.title}</span>
                            <span className="text-meta text-muted">{o.detail}</span>
                          </span>
                        </Radio>
                      ))}
                    </RadioGroup>
                  </div>
                  <div className="flex items-center gap-2 text-ui font-semibold">
                    <span>Most findings to show</span>
                    <Select<string> label="Most findings to show" value={String(aiReview.maxFindings)} options={FINDING_LIMITS.map((n) => ({ value: String(n), label: String(n) }))} onChange={(v) => setAiReview({ ...aiReview, maxFindings: Number(v) })} />
                  </div>
                </>
              )}
            </Section>
          )}

          <section className="flex flex-col gap-3 rounded-xl border border-border bg-card px-4 py-3">
            <SectionHeader as="h2" toggle={{ expanded: advanced, onToggle: () => setAdvanced(!advanced) }}>
              Advanced: name, GitHub, what needs a review
            </SectionHeader>
            {advanced && (
              <div className="flex flex-col gap-5 pb-1">
                <label className="flex flex-col gap-1 text-ui font-semibold">
                  Name
                  <input className={`${FIELD_LG} max-w-md font-normal`} value={name ?? folderName} onChange={(e) => setName(e.target.value)} placeholder={folderName || 'my-project'} />
                  <span className="text-meta font-normal text-muted">How the inbox and reviews show this project. Leave it empty to use the folder's name.</span>
                </label>

                <div className="flex flex-col gap-1.5">
                  <SectionHeader as="h3">GitHub</SectionHeader>
                  <Checkbox checked={!!github} disabled={!ok || !onGitHub || linking} onChange={toggleGithub}>
                    Link the GitHub remote {github && <Pill tone="ok" className="ml-1.5">{github}</Pill>}
                  </Checkbox>
                  <span className="pl-6 text-meta text-muted">
                    {linking ? 'Checking with the GitHub CLI…' : ok && !onGitHub ? 'The remote is not on GitHub.' : 'Uses your GitHub CLI sign-in to list open pull requests, including the ones GitHub Copilot opens. Nothing is posted until you finish a review.'}
                  </span>
                  {githubError && <Notice tone="error">{githubError}</Notice>}
                </div>

                <div className="flex flex-col gap-2">
                  <SectionHeader as="h3">What needs a review</SectionHeader>
                  <Checkbox checked={anyBranch} onChange={setAnyBranch}>
                    Any branch <span className="text-muted">(recommended)</span>
                  </Checkbox>
                  <span className="-mt-1 pl-6 text-meta text-muted">Every local branch with commits on top of the base, from an agent or a person.</span>
                  <Checkbox checked={usePattern} onChange={setUsePattern}>
                    Branches matching a pattern
                  </Checkbox>
                  <div className="-mt-1 pl-6">
                    {usePattern ? <input aria-label="Branch pattern" className={`${FIELD} w-full max-w-sm font-mono`} value={pattern} onChange={(e) => setPattern(e.target.value)} /> : <span className="font-mono text-meta text-muted">{pattern}</span>}
                  </div>
                  <Checkbox checked={pullRequests} disabled={!github} onChange={setPullRequests}>
                    Every open pull request
                  </Checkbox>
                  <span className="-mt-1 pl-6 text-meta text-muted">{github ? 'From anyone, agents or people. Fetched into a private ref, your branches stay as they are.' : 'Link the GitHub remote above first.'}</span>
                  <p className="text-meta text-muted">Pick any mix: a branch more than one of them finds shows up once. You can always review another branch from the inbox.</p>
                </div>
              </div>
            )}
          </section>

          {error && <Notice tone="error">{error}</Notice>}
          <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
            {existing && (
              <Button variant="danger" size="lg" className="mr-auto" onClick={() => setRemoving(true)}>
                Remove project…
              </Button>
            )}
            {blocked && ok && <span className="text-meta text-muted">{blocked}</span>}
            <Button size="lg" onClick={() => go(back)}>
              Cancel
            </Button>
            <Button variant="primary" size="lg" shortcut="connect.save" disabled={!!blocked || saving} aria-busy={saving} data-tooltip={blocked ?? undefined} onClick={save}>
              {saving ? 'Saving…' : existing ? 'Save changes' : 'Connect and open the inbox'}
            </Button>
          </div>
        </div>
      </div>
      {removing && existing && (
        <Dialog
          title={`Stop watching ${existing.name}?`}
          width="sm"
          role="alertdialog"
          onClose={() => setRemoving(false)}
          onSubmit={remove}
          footer={
            <>
              <Button kbd="Esc" onClick={() => setRemoving(false)}>
                Cancel
              </Button>
              <Button variant="danger" filled kbd="mod+enter" onClick={remove}>
                Remove project
              </Button>
            </>
          }
        >
          <p className="px-5 py-4 text-body text-muted">Your reviews stay saved, and nothing in the repo changes. You can connect it again any time.</p>
        </Dialog>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
      <h2 className="text-title font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Tile({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-lg bg-sidebar p-2.5">
      <span className="text-meta text-faint">{label}</span>
      <span className="text-ui font-semibold">{children}</span>
    </div>
  );
}
