import { useEffect, useState } from 'react';
import type { Go, Route } from '../App.tsx';
import { Brand, Crumbs, Later, cleanError, plural, rememberProjectName } from '../components/ui.tsx';
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
    if (!existing || !window.confirm(`Stop watching ${existing.name}? Your reviews stay saved; nothing in the repo changes.`)) return;
    await window.api.removeProject(existing.id);
    go({ name: 'home' });
  };

  const ok = !!check?.isRepo;
  // What an empty Name falls back to, like the main process does.
  const folderName = (check?.root ?? existing?.path ?? path).replace(/\/+$/, '').split('/').pop() ?? '';
  const onGitHub = !!check?.remote?.startsWith('github.com/');
  const baseOptions = check ? [...new Set([base, check.baseBranch, ...check.branches].filter(Boolean) as string[])] : [];

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
        <p style={{ margin: '0 0 8px', fontSize: 15, lineHeight: 1.6, color: 'var(--muted)' }}>
          A project is one git repo on your machine. Hunkdory connects it to two things: where the agent's changes live, and where the agent's reasoning lives.
        </p>

        {/* Adding a project: the repos you work in with Claude Code, one click from filling in the folder. */}
        {!projectId && !path.trim() && <FoundOnThisMac onPick={setPath} />}

        <Section n={1} title="Repository">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label htmlFor="project-name" style={{ fontSize: 13, fontWeight: 600 }}>
              Name
            </label>
            <input id="project-name" className="field" value={name ?? folderName} onChange={(e) => setName(e.target.value)} placeholder={folderName || 'my-project'} style={{ maxWidth: 420 }} />
            <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>How the inbox and reviews show this project. Leave it empty to use the folder's name.</span>
          </div>
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
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10 }}>
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
            <Tile label="Remote">
              <span className="mono" style={{ overflowWrap: 'anywhere' }}>
                {check?.remote ?? '–'}
              </span>
            </Tile>
          </div>
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
                    : 'Uses your GitHub CLI sign-in to list open pull requests and fetch them. Nothing is posted to GitHub.'}
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
        </Section>

        <Section n={2} title="Agent sources">
          <p style={{ fontSize: 14, lineHeight: 1.55, color: 'var(--muted)' }}>
            Sessions hold your prompt and the agent's reasoning. Hunkdory uses them to explain each change and split it into steps. Without a session it still works, with less context.
          </p>
          <Source
            name="Claude Code"
            where={check?.sessionSources.length ? check.sessionSources.map((s) => `${s.dir} (${s.sessions})`).join(' · ') : '~/.claude and any ~/.claude-* config folder'}
            on
            status={ok ? (check!.sessionCount ? `${plural(check!.sessionCount, 'session')} found` : 'Nothing found') : '–'}
            good={!!check?.sessionCount}
          />
          <Source
            name="GitHub Copilot coding agent"
            where={github ? `Open PRs by Copilot on ${github} show up as agent work. Send back asks @copilot on the PR.` : 'Link the GitHub remote below to review PRs Copilot opens.'}
            on={!!github}
            status={github ? 'On' : 'Needs GitHub'}
            good={!!github}
          />
          <Source name="Codex CLI" where="~/.codex/sessions" status="Later" />
          <label className="choice">
            <input type="checkbox" checked={!!writeWalkthroughs} onChange={(e) => setWriteWalkthroughs(e.target.checked)} />
            <span>
              <strong>Let Claude write walkthroughs</strong>
              <br />
              <span className="muted">
                For a branch that opens without one. Claude Code reads the diff, the commits and the session, and like any Claude Code run that goes to Anthropic. Off: you get one step per file, and a button to
                write one when you want it.
              </span>
            </span>
          </label>
        </Section>

        <Section n={3} title="What needs a review">
          <fieldset style={{ border: 0, margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <legend className="sr-only">Watch rules</legend>
            <label className="choice">
              <input type="checkbox" checked={anyBranch} onChange={(e) => setAnyBranch(e.target.checked)} />
              <span>
                <strong>Any branch</strong> <span className="muted">(recommended)</span>
                <br />
                <span className="muted">Every local branch with commits on top of the base, from an agent or a person. A session on it adds the prompt and the agent's reasoning.</span>
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
                <span className="muted">{github ? 'From anyone, agents or people. Fetched into a private ref, your branches stay as they are.' : 'Link the GitHub remote first.'}</span>
              </span>
            </label>
          </fieldset>
          <p style={{ fontSize: 13, color: 'var(--muted)' }}>Pick any mix: a branch more than one of them finds shows up once. Whatever you pick, you can review any other branch with “Review a branch” in the inbox.</p>
        </Section>

        <Section n={4} title="Where your feedback goes">
          <p style={{ fontSize: 14, lineHeight: 1.55, color: 'var(--muted)' }}>
            You pick when you finish each review. Branches from a Claude Code session can go back to that session. Pull requests can get your review on GitHub, with line comments on their lines
            {github ? '' : ' (link the GitHub remote for that)'}. Copilot's PRs go back to Copilot through the PR.
          </p>
        </Section>

        {error && <p className="error">{error}</p>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, paddingTop: 8 }}>
          {existing && (
            <button type="button" className="btn lg" style={{ marginRight: 'auto', color: 'var(--high-fg)' }} onClick={remove}>
              Remove project
            </button>
          )}
          <button type="button" className="btn lg" onClick={() => go(back)}>
            Cancel
          </button>
          <button type="button" className="btn lg primary" disabled={!ok || !base || saving || (usePattern && !pattern.trim()) || (!anyBranch && !usePattern && !pullRequests)} onClick={save}>
            {saving ? 'Saving…' : existing ? 'Save changes' : 'Connect project'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="card" style={{ padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <span style={{ width: 26, height: 26, borderRadius: 999, background: 'var(--accent-fill)', color: 'var(--on-accent)', fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{n}</span>
        <h2 style={{ fontSize: 16 }}>{title}</h2>
      </div>
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

function Source({ name, where, status, on = false, good = false }: { name: string; where: string; status: string; on?: boolean; good?: boolean }) {
  return (
    <label className={on ? 'choice' : 'choice off'} style={{ flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', border: '1px solid var(--border)', borderRadius: 10 }}>
      <span style={{ display: 'flex', gap: 10, alignItems: 'center', minWidth: 0, flex: '1 1 300px' }}>
        <input type="checkbox" checked={on} disabled readOnly style={{ marginTop: 0 }} />
        <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>{name}</span>
          <span className="mono" style={{ fontSize: 12.5, color: 'var(--muted)', overflowWrap: 'anywhere' }}>
            {where}
          </span>
        </span>
      </span>
      <span className={`pill ${good ? 'low' : 'neutral'}`} style={{ fontSize: 12.5, padding: '3px 10px' }}>
        {status}
      </span>
    </label>
  );
}
