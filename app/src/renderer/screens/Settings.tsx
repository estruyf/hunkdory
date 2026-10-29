import { useEffect, useState } from 'react';
import type { Go } from '../App.tsx';
import { Brand, Crumbs, useAsync } from '../components/ui.tsx';
import type { AppInfo, Theme } from '../../shared/types.ts';

const THEMES: { value: Theme; label: string; hint: string }[] = [
  { value: 'light', label: 'Light', hint: 'Always light' },
  { value: 'dark', label: 'Dark', hint: 'Always dark' },
  { value: 'system', label: 'System', hint: 'Follows macOS' },
];

/** The app's own settings. Project settings live behind the gear next to each project. */
export function Settings({ go }: { go: Go }) {
  const settings = useAsync(() => window.api.settings(), []);
  const info = useAsync(() => window.api.appInfo(), []);
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
