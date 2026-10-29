import { useEffect, useState } from 'react';
import type { Go, Route } from '../App.tsx';
import { Brand, ConfirmButton, Crumbs, cleanError, rememberProjectName } from '../components/ui.tsx';
import { FoundOnThisMac } from '../components/found.tsx';
import type { Project, RepoCheck, Watch } from '../../shared/types.ts';

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
  const [linking, setLinking] = useState(false);
  const [githubError, setGithubError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // New projects keep the details folded away: the defaults suit most repos.
  const [advanced, setAdvanced] = useState(!!projectId);

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
    try {
      if (existing) {
        const saved = await window.api.updateProject(existing.id, { name: name ?? existing.name, baseBranch: base, watch: w, github, writeWalkthroughs });
        rememberProjectName(saved.id, saved.name);
      } else await window.api.addProject({ path: check!.root!, name: name ?? folderName, baseBranch: base, watch: w, github, writeWalkthroughs });
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

  return (
    <div className="page">
      <header className="topbar">
        <Brand onClick={() => go(back)} />
        <Crumbs
          items={[
            { label: back.name === 'home' ? 'Inbox' : 'Welcome', onClick: () => go(back) },
            ...(existing ? [{ label: existing.name, onClick: () => go({ name: 'home', projectId: existing.id }) }, { label: 'Settings' }] : [{ label: 'Connect a project' }]),
          ]}
        />
      </header>

      <div style={{ width: '100%', maxWidth: 860, margin: '0 auto', padding: '32px 24px 48px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <p style={{ margin: '0 0 8px', fontSize: 15, lineHeight: 1.6, color: 'var(--muted)' }}>A project is one git repo on your machine. The defaults suit most repos: pick the folder, choose how steps get written, and connect.</p>

        {/* Adding a project: the repos you work in with Claude Code, one click from filling in the folder. */}
        {!projectId && !path.trim() && <FoundOnThisMac onPick={setPath} />}

        <Section title="Repository">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
            <label htmlFor="folder" style={{ fontSize: 13, fontWeight: 600, width: '100%' }}>
              Folder
            </label>
            <input id="folder" className="field mono" value={path} readOnly={!!existing} onChange={(e) => setPath(e.target.value)} placeholder="~/dev/my-project" style={{ flex: '1 1 300px', fontSize: 13.5, background: existing ? 'var(--bg)' : undefined }} />
            {!existing && (
              <button type="button" className="btn" onClick={choose}>
                Choose…
              </button>
            )}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 10 }}>
            <Tile label="Git repo">
              {checking ? (
                <span className="muted">Checking…</span>
              ) : !check ? (
                <span className="muted">Pick a folder</span>
              ) : ok ? (
                <span style={{ color: 'var(--low-fg)' }}>Detected ✓</span>
              ) : (
                <span style={{ color: 'var(--high-fg)' }}>{check.error}</span>
              )}
            </Tile>
            <Tile label="Base branch">
              {ok ? (
                <select aria-label="Base branch" value={base} onChange={(e) => setBase(e.target.value)} style={{ font: 'inherit', fontFamily: 'var(--mono)', fontSize: 14, fontWeight: 600, border: 0, background: 'transparent', padding: 0, maxWidth: '100%' }}>
                  {!base && <option value="">Choose…</option>}
                  {baseOptions.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="muted">–</span>
              )}
            </Tile>
            <Tile label="Claude Code sessions">
              <span style={{ color: check?.sessionCount ? 'var(--low-fg)' : undefined }}>{ok ? (check!.sessionCount ? `${check!.sessionCount} found` : 'None yet') : '–'}</span>
            </Tile>
            <Tile label="Remote">
              <span className="mono" style={{ overflowWrap: 'anywhere', fontSize: 12.5 }}>
                {check?.remote ?? '–'}
              </span>
            </Tile>
          </div>
          {ok && !check!.sessionCount && <p style={{ fontSize: 13, color: 'var(--muted)' }}>No sessions yet in ~/.claude or any ~/.claude-* folder. Reviews still work, with less context: no prompt and no agent reasons.</p>}
        </Section>

        <Section title="How should Hunkdory split changes into steps?">
          <div role="radiogroup" aria-label="Walkthroughs" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <label className="option" data-on={writeWalkthroughs === true} style={{ cursor: 'pointer' }}>
              <span className="choice">
                <input type="radio" name="walkthroughs" checked={writeWalkthroughs === true} onChange={() => setWriteWalkthroughs(true)} />
                <span>
                  <strong>Let Claude write a walkthrough</strong> <span className="muted">(recommended)</span>
                  <br />
                  <span className="muted">Steps by intent, with a reason for each. For a branch that opens without one, Claude Code reads the diff, the commits and the session. Like any Claude Code run, that goes to Anthropic.</span>
                </span>
              </span>
            </label>
            <label className="option" data-on={writeWalkthroughs === false} style={{ cursor: 'pointer' }}>
              <span className="choice">
                <input type="radio" name="walkthroughs" checked={writeWalkthroughs === false} onChange={() => setWriteWalkthroughs(false)} />
                <span>
                  <strong>One step per file, fully offline</strong>
                  <br />
                  <span className="muted">Nothing is sent anywhere. You can still ask for a walkthrough on a branch when you want one.</span>
                </span>
              </span>
            </label>
          </div>
          {writeWalkthroughs === undefined && <p style={{ fontSize: 13, color: 'var(--muted)' }}>Not chosen yet: Hunkdory asks the first time a branch opens without a walkthrough.</p>}
        </Section>

        <section className="card" style={{ padding: '6px 22px' }}>
          <button type="button" className="link" aria-expanded={advanced} onClick={() => setAdvanced(!advanced)} style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 0', fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>
            <span>Advanced: name, GitHub, what needs a review</span>
            <span style={{ color: 'var(--accent)', fontSize: 13.5, fontWeight: 500 }}>{advanced ? 'Hide' : 'Show'}</span>
          </button>
          {advanced && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18, padding: '4px 0 20px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label htmlFor="project-name" style={{ fontSize: 13, fontWeight: 600 }}>
                  Name
                </label>
                <input id="project-name" className="field" value={name ?? folderName} onChange={(e) => setName(e.target.value)} placeholder={folderName || 'my-project'} style={{ maxWidth: 420 }} />
                <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>How the inbox and reviews show this project. Leave it empty to use the folder's name.</span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <h3 style={{ margin: 0, fontSize: 14 }}>GitHub</h3>
                <label className={ok && onGitHub ? 'choice' : 'choice off'}>
                  <input type="checkbox" checked={!!github} disabled={!ok || !onGitHub || linking} onChange={(e) => toggleGithub(e.target.checked)} />
                  <span>
                    <strong>Link the GitHub remote</strong>
                    {github && <span className="pill low" style={{ marginLeft: 8 }}>{github}</span>}
                    <br />
                    <span className="muted">
                      {linking
                        ? 'Checking with the GitHub CLI…'
                        : ok && !onGitHub
                          ? 'The remote is not on GitHub.'
                          : 'Uses your GitHub CLI sign-in to list open pull requests, including the ones GitHub Copilot opens. Nothing is posted until you finish a review.'}
                    </span>
                    {githubError && (
                      <>
                        <br />
                        <span className="error" style={{ fontSize: 13 }}>
                          {githubError}
                        </span>
                      </>
                    )}
                  </span>
                </label>
              </div>

              <fieldset style={{ border: 0, margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <legend style={{ fontSize: 14, fontWeight: 700, padding: 0, marginBottom: 10 }}>What needs a review</legend>
                <label className="choice">
                  <input type="checkbox" checked={anyBranch} onChange={(e) => setAnyBranch(e.target.checked)} />
                  <span>
                    <strong>Any branch</strong> <span className="muted">(recommended)</span>
                    <br />
                    <span className="muted">Every local branch with commits on top of the base, from an agent or a person.</span>
                  </span>
                </label>
                <label className="choice">
                  <input type="checkbox" checked={usePattern} onChange={(e) => setUsePattern(e.target.checked)} />
                  <span style={{ flex: 1 }}>
                    <strong>Branches matching a pattern</strong>
                    <br />
                    {usePattern ? (
                      <input aria-label="Branch pattern" className="field mono" value={pattern} onChange={(e) => setPattern(e.target.value)} style={{ marginTop: 6, height: 34, fontSize: 13, width: '100%', maxWidth: 360 }} />
                    ) : (
                      <span className="muted mono" style={{ fontSize: 13 }}>
                        {pattern}
                      </span>
                    )}
                  </span>
                </label>
                <label className={github ? 'choice' : 'choice off'}>
                  <input type="checkbox" disabled={!github} checked={pullRequests} onChange={(e) => setPullRequests(e.target.checked)} />
                  <span>
                    <strong>Every open pull request</strong>
                    <br />
                    <span className="muted">{github ? 'From anyone, agents or people. Fetched into a private ref, your branches stay as they are.' : 'Link the GitHub remote above first.'}</span>
                  </span>
                </label>
                <p style={{ fontSize: 13, color: 'var(--muted)' }}>Pick any mix: a branch more than one of them finds shows up once. You can always review another branch from the inbox.</p>
              </fieldset>
            </div>
          )}
        </section>

        {error && <p className="error">{error}</p>}
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', alignItems: 'center', gap: 10, paddingTop: 8 }}>
          {existing && (
            <ConfirmButton label="Remove project" question={`Stop watching ${existing.name}? Reviews stay saved; nothing in the repo changes.`} confirm="Remove" onConfirm={remove} style={{ marginRight: 'auto' }} />
          )}
          {blocked && ok && <span style={{ fontSize: 13, color: 'var(--muted)' }}>{blocked}</span>}
          <button type="button" className="btn lg" onClick={() => go(back)}>
            Cancel
          </button>
          <button type="button" className="btn lg primary" disabled={!!blocked || saving} title={blocked ?? undefined} onClick={save}>
            {saving ? 'Saving…' : existing ? 'Save changes' : 'Connect and open inbox'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="card" style={{ padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <h2 style={{ fontSize: 16 }}>{title}</h2>
      {children}
    </section>
  );
}

function Tile({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ padding: 12, background: 'var(--bg)', borderRadius: 8, display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
      <span style={{ fontSize: 12, color: 'var(--muted)' }}>{label}</span>
      <span style={{ fontSize: 14, fontWeight: 600 }}>{children}</span>
    </div>
  );
}
