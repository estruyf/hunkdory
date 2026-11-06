import { useState } from 'react';
import { ImageUp, Smile } from 'lucide-react';
import { ProjectIcon } from './ProjectIcon.tsx';
import { cleanError } from './ui.tsx';
import { Button } from './ui/Button.tsx';
import { Notice } from './ui/Notice.tsx';
import { FIELD } from './ui/field.ts';
import type { ProjectIconChoice, ProjectIconInfo } from '../../shared/types.ts';

const SUGGESTED = ['🚀', '🧪', '📦', '🛠️', '🌐', '📱', '🎨', '📝', '🤖', '⚡️', '🔥', '🧩', '📊', '🎬', '🚲', '☁️'];

/** The first character you see in what was typed: one emoji, even when it's made of several code points. */
const firstEmoji = (text: string) => [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text.trim())][0]?.segment ?? '';

/**
 * A project's icon in its settings: what shows now and where it came from, and the ways to change it. A choice only
 * takes effect when the settings are saved, like everything else on the page.
 */
export function IconPicker({ name, shown, detected, onChange }: {
  name: string;
  /** What the project shows with the choices so far. */
  shown: ProjectIconInfo;
  /** What the repo has, whatever you picked. */
  detected: ProjectIconInfo;
  onChange(choice: ProjectIconChoice, shown: ProjectIconInfo): void;
}) {
  const [emoji, setEmoji] = useState(false);
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);

  const chooseImage = async () => {
    setError(null);
    try {
      const picked = await window.api.chooseIconFile();
      if (picked) onChange({ kind: 'file', path: picked.path }, { icon: picked.icon, source: 'custom', path: null });
    } catch (e) {
      setError(cleanError(e));
    }
  };
  const chooseEmoji = (value: string) => {
    if (!value) return;
    onChange({ kind: 'emoji', value }, { icon: { kind: 'emoji', value }, source: 'custom', path: null });
    setEmoji(false);
    setTyped('');
  };

  const status =
    shown.source === 'detected'
      ? `Found in the repo: ${shown.path}`
      : shown.source === 'custom' && shown.icon
        ? 'You picked this one.'
        : shown.source === 'custom'
          ? detected.icon
            ? 'Showing the letter. The repo has an icon you can use instead.'
            : 'Showing the letter.'
          : 'No icon found in this repo, so it shows a letter. You can pick one.';

  return (
    <div className="flex flex-col gap-2">
      <span className="text-ui font-semibold">Icon</span>
      <div className="flex flex-wrap items-center gap-3">
        <ProjectIcon name={name || '?'} size={40} icon={shown.icon} />
        <span className="flex min-w-0 flex-[1_1_260px] flex-col gap-1.5">
          <span className="font-normal break-all text-meta text-muted">{status}</span>
          <span className="flex flex-wrap items-center gap-2">
            <Button size="sm" icon={<ImageUp size={13} aria-hidden />} onClick={chooseImage}>
              Choose an image…
            </Button>
            <Button size="sm" icon={<Smile size={13} aria-hidden />} aria-expanded={emoji} onClick={() => setEmoji(!emoji)}>
              Pick an emoji
            </Button>
            {shown.source === 'custom' && (
              <Button variant="quiet" size="sm" onClick={() => onChange({ kind: 'auto' }, detected)}>
                {detected.icon ? 'Use the one from the repo' : 'Use the letter'}
              </Button>
            )}
            {shown.source === 'detected' && (
              <Button variant="quiet" size="sm" onClick={() => onChange({ kind: 'none' }, { icon: null, source: 'custom', path: null })}>
                Use the letter
              </Button>
            )}
          </span>
        </span>
      </div>
      {emoji && (
        <div className="flex flex-col gap-2 rounded-lg border border-edge p-2.5">
          <div role="group" aria-label="Suggested emoji" className="flex flex-wrap gap-1">
            {SUGGESTED.map((e) => (
              <button key={e} type="button" aria-label={`Use ${e}`} onClick={() => chooseEmoji(e)} className="flex size-8 items-center justify-center rounded text-title hover:bg-border/45">
                {e}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              aria-label="Any emoji"
              className={`${FIELD} w-56 font-normal`}
              placeholder="Or type any emoji (⌃⌘Space)"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return;
                // Enter here picks the emoji, not the project's settings.
                e.preventDefault();
                chooseEmoji(firstEmoji(typed));
              }}
            />
            <Button size="sm" disabled={!typed.trim()} onClick={() => chooseEmoji(firstEmoji(typed))}>
              Use it
            </Button>
          </div>
        </div>
      )}
      {error && <Notice tone="error">{error}</Notice>}
    </div>
  );
}
