import { useEffect, useState } from 'react';
import type { Go } from '../App.tsx';
import { Plus, X } from 'lucide-react';
import { Crumbs, isPlainKey, useAsync, usePref } from '../components/ui.tsx';
import { matches } from '../lib/shortcuts.ts';
import { ViewHeader } from '../components/ViewHeader.tsx';
import { ProjectIcon } from '../components/ProjectIcon.tsx';
import { Button } from '../components/ui/Button.tsx';
import { Checkbox } from '../components/ui/Checkbox.tsx';
import { Kbd } from '../components/ui/Kbd.tsx';
import { Notice } from '../components/ui/Notice.tsx';
import { SegmentedControl } from '../components/ui/SegmentedControl.tsx';
import { Select } from '../components/ui/Select.tsx';
import { FIELD } from '../components/ui/field.ts';
import type { DiffMode } from '../components/diff.tsx';
import type { AppInfo, Theme } from '../../shared/types.ts';

const THEMES: { value: Theme; label: string; hint: string }[] = [
  { value: 'light', label: 'Light', hint: 'Always light' },
  { value: 'dark', label: 'Dark', hint: 'Always dark' },
  { value: 'system', label: 'System', hint: 'Follows macOS' },
];

/** The app's own settings, review defaults, and a way into each project's settings. */
export function Settings({ go, onClose }: { go: Go; onClose(): void }) {
  // Esc closes Settings before the view under it sees the key (Esc in a review goes back to the plan).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!matches(e, 'settings.close') || !isPlainKey(e)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
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
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <ViewHeader>
        <div className="min-w-0 flex-1">
          <Crumbs items={[{ label: 'Settings' }]} />
        </div>
        <Button variant="quiet" iconOnly aria-label="Close Settings" shortcut="settings.close" icon={<X size={15} aria-hidden />} onClick={onClose} />
      </ViewHeader>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-6 pt-7 pb-14">
          <h1 className="text-hero font-semibold">Settings</h1>

          <Card title="Appearance">
            <Row label="Theme" detail="Light, dark, or follow macOS.">
              <SegmentedControl<Theme> mode="radio" label="Theme" value={theme ?? 'system'} onChange={pick} segments={THEMES.map((t) => ({ value: t.value, label: t.label, tooltip: t.hint }))} />
            </Row>
            {settings.error && <Notice tone="error">{settings.error}</Notice>}
          </Card>

          <Card title="Inbox">
            <Row label="Order" detail="How To review sorts the branches.">
              <Select
                label="Order"
                value={order}
                onChange={setOrder}
                options={[
                  { value: 'suggested', label: 'What to review first' },
                  { value: 'newest', label: 'Newest first' },
                ]}
                className={`${FIELD} w-48`}
              />
            </Row>
          </Card>

          <Card title="Review defaults">
            <Row label="Diff layout" detail="S switches it during a review.">
              <SegmentedControl<DiffMode>
                mode="radio"
                label="Diff layout"
                value={mode}
                onChange={setMode}
                segments={[
                  { value: 'unified', label: 'Unified' },
                  { value: 'split', label: 'Side by side' },
                ]}
              />
            </Row>
            <Checkbox checked={ignoreSpace} onChange={setIgnoreSpace}>
              Hide whitespace changes in diffs
            </Checkbox>
            <Checkbox checked={showContext} onChange={setShowContext}>
              Show the Context panel next to a step when the window is wide enough
            </Checkbox>
            <Checkbox checked={howItWorks} onChange={setHowItWorks}>
              Show “How a review works” on the plan
            </Checkbox>
          </Card>

          <Card title="Projects">
            {projects.value?.length === 0 && <p className="text-ui text-muted">No projects yet.</p>}
            <ul className="m-0 flex list-none flex-col gap-px p-0">
              {projects.value?.map((p) => (
                <li key={p.id} className="flex items-center gap-3 rounded-lg px-1 py-1.5">
                  <ProjectIcon name={p.name} size={22} />
                  <span className="grid min-w-0 flex-1">
                    <span className="truncate text-body font-semibold">{p.name}</span>
                    <span className="truncate font-mono text-meta text-faint">{p.path}</span>
                  </span>
                  <Button onClick={() => go({ name: 'connect', projectId: p.id })}>Settings</Button>
                </li>
              ))}
            </ul>
            <div>
              <Button variant="quiet" icon={<Plus size={14} aria-hidden />} onClick={() => go({ name: 'connect' })}>
                Add project
              </Button>
            </div>
          </Card>

          <Card title="About">
            {info.value && (
              <>
                <p className="text-body">
                  <strong className="font-semibold">Hunkdory {info.value.version}</strong>
                  <span className="text-muted">
                    {' '}
                    · Electron {info.value.electron} · Chromium {info.value.chrome} · Node {info.value.node}
                  </span>
                </p>
                <p className="text-meta text-muted">{info.value.os}</p>
                <div>
                  <Button onClick={copy}>{copied ? 'Copied' : 'Copy for a bug report'}</Button>
                </div>
              </>
            )}
          </Card>
          <p className="flex items-center gap-1.5 text-meta text-faint">
            <Kbd shortcut="shortcuts" /> every keyboard shortcut
          </p>
        </div>
      </div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
      <h2 className="text-title font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Row({ label, detail, children }: { label: string; detail: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
      <span className="flex min-w-0 flex-col">
        <span className="text-ui font-semibold">{label}</span>
        <span className="text-meta text-muted">{detail}</span>
      </span>
      {children}
    </div>
  );
}

const versionText = (i: AppInfo) => `Hunkdory ${i.version}\nElectron ${i.electron} · Chromium ${i.chrome} · Node ${i.node}\n${i.os}`;
