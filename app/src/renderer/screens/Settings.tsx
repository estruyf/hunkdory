import { useEffect, useState } from 'react';
import type { Go } from '../App.tsx';
import { Brand, Crumbs, GearIcon, useAsync, usePref } from '../components/ui.tsx';
import type { DiffMode } from '../components/diff.tsx';
import type { AppInfo, Theme } from '../../shared/types.ts';

const THEMES: { value: Theme; label: string; hint: string }[] = [
  { value: 'light', label: 'Light', hint: 'Always light' },
  { value: 'dark', label: 'Dark', hint: 'Always dark' },
  { value: 'system', label: 'System', hint: 'Follows macOS' },
];

/** The app's own settings, review defaults, and a way into each project's settings. */
export function Settings({ go }: { go: Go }) {
  const settings = useAsync(() => window.api.settings(), []);
  const info = useAsync(() => window.api.appInfo(), []);
  const projects = useAsync(() => window.api.listProjects(), []);
  // The same prefs the review screens keep when you change them in place.
  const [mode, setMode] = usePref<DiffMode>('diff-mode', 'unified');
  const [ignoreSpace, setIgnoreSpace] = usePref<boolean>('diff-ignore-space', false);
  const [showContext, setShowContext] = usePref<boolean>('walkthrough-context', true);
  const [order, setOrder] = usePref<'suggested' | 'newest'>('inbox-order', 'suggested');
  const [howItWorks, setHowItWorks] = usePref<boolean>('plan-how-it-works', true);
  const [theme, setTheme] = useState<Theme | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (settings.value) setTheme(settings.value.theme);
  }, [settings.value]);

  // The main process applies it to the window at once; the CSS follows prefers-color-scheme.
  const pick = async (t: Theme) => {
    setTheme(t);
    await window.api.setTheme(t);
  };

  const copy = async () => {
    await navigator.clipboard.writeText(versionText(info.value!));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="page">
      <header className="topbar">
        <Brand onClick={() => go({ name: 'home' })} />
        <Crumbs items={[{ label: 'Inbox', onClick: () => go({ name: 'home' }) }, { label: 'Settings' }]} />
      </header>

      <div style={{ width: '100%', maxWidth: 860, margin: '0 auto', padding: '32px 24px 48px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <h1 style={{ fontSize: 26, letterSpacing: '-0.015em' }}>Settings</h1>

        <section className="card" style={{ padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <h2 id="theme-label" style={{ fontSize: 16 }}>
            Theme
          </h2>
          <div role="radiogroup" aria-labelledby="theme-label" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10 }}>
            {THEMES.map((t) => (
              <label key={t.value} className="card" style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '12px 14px', cursor: 'pointer', borderColor: theme === t.value ? 'var(--accent)' : undefined, background: theme === t.value ? 'var(--accent-soft)' : undefined }}>
                <input type="radio" name="theme" value={t.value} checked={theme === t.value} disabled={!theme} onChange={() => pick(t.value)} style={{ margin: '2px 0 0', accentColor: 'var(--accent-fill)' }} />
                <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ fontSize: 14, fontWeight: 600 }}>{t.label}</span>
                  <span style={{ fontSize: 13, color: 'var(--muted)' }}>{t.hint}</span>
                </span>
              </label>
            ))}
          </div>
          {settings.error && <p className="error">{settings.error}</p>}
        </section>

        <section className="card" style={{ padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <h2 style={{ fontSize: 16 }}>Review defaults</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '12px 20px', alignItems: 'center', fontSize: 14 }}>
            <label htmlFor="pref-mode">Diff layout</label>
            <select id="pref-mode" className="field" value={mode} onChange={(e) => setMode(e.target.value as DiffMode)} style={{ height: 34, maxWidth: 220 }}>
              <option value="unified">Unified</option>
              <option value="split">Side by side</option>
            </select>
            <label htmlFor="pref-order">Inbox order</label>
            <select id="pref-order" className="field" value={order} onChange={(e) => setOrder(e.target.value as 'suggested' | 'newest')} style={{ height: 34, maxWidth: 220 }}>
              <option value="suggested">What to review first</option>
              <option value="newest">Newest first</option>
            </select>
          </div>
          <label className="choice">
            <input type="checkbox" checked={ignoreSpace} onChange={(e) => setIgnoreSpace(e.target.checked)} />
            Hide whitespace changes in diffs
          </label>
          <label className="choice">
            <input type="checkbox" checked={showContext} onChange={(e) => setShowContext(e.target.checked)} />
            Show the context panel next to a step when the window is wide enough
          </label>
          <label className="choice">
            <input type="checkbox" checked={howItWorks} onChange={(e) => setHowItWorks(e.target.checked)} />
            Show “How a review works” on the plan
          </label>
        </section>

        <section className="card" style={{ padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <h2 style={{ fontSize: 16 }}>Projects</h2>
          {projects.value?.length === 0 && <p className="muted" style={{ fontSize: 14 }}>No projects yet.</p>}
          {projects.value?.map((p) => (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', borderTop: '1px solid var(--divider)' }}>
              <span style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>{p.name}</span>
                <span className="mono" style={{ fontSize: 12.5, color: 'var(--muted)', overflowWrap: 'anywhere' }}>
                  {p.path}
                </span>
              </span>
              <button type="button" className="btn" style={{ height: 34, gap: 6 }} onClick={() => go({ name: 'connect', projectId: p.id })}>
                <GearIcon /> Settings
              </button>
            </div>
          ))}
          <div>
            <button type="button" className="link" style={{ fontSize: 14, fontWeight: 500 }} onClick={() => go({ name: 'connect' })}>
              + Add project
            </button>
          </div>
        </section>

        <section className="card" style={{ padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <h2 style={{ fontSize: 16 }}>About</h2>
          {info.value && (
            <>
              <p style={{ fontSize: 14, lineHeight: 1.6 }}>
                <strong style={{ fontWeight: 600 }}>Hunkdory {info.value.version}</strong>
                <span className="muted">
                  {' '}
                  · Electron {info.value.electron} · Chromium {info.value.chrome} · Node {info.value.node}
                </span>
              </p>
              <p className="muted" style={{ fontSize: 13 }}>
                {info.value.os}
              </p>
              <div>
                <button type="button" className="btn" style={{ height: 34 }} onClick={copy}>
                  {copied ? 'Copied' : 'Copy for a bug report'}
                </button>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

const versionText = (i: AppInfo) => `Hunkdory ${i.version}\nElectron ${i.electron} · Chromium ${i.chrome} · Node ${i.node}\n${i.os}`;
