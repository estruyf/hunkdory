import { Fragment, type HTMLAttributes } from 'react';
import { keyPieces, keysFor, shortcutGlyphs, spokenKeys, type ShortcutId } from '../../lib/shortcuts.ts';

export type KbdTone = 'default' | 'on-accent' | 'plain' | 'cap';

const TONE: Record<KbdTone, string> = {
  // A small keycap; the overlay border stays visible on dialogs and popovers.
  default: 'rounded border border-edge px-1 text-faint',
  // Inside a yellow button: the button's own ink, softened, without a keycap.
  'on-accent': 'text-on-accent/60',
  plain: 'text-faint',
  // One key on its own cap (the shortcuts sheet): 20px tall, a deeper bottom edge, a step above the surface.
  cap: 'inline-flex h-5 min-w-5 items-center justify-center rounded border border-b-2 border-edge bg-text/8 px-1 text-muted',
};

interface KbdProps extends Omit<HTMLAttributes<HTMLElement>, 'children'> {
  /** What to press: glyphs as shown (`⌘↵`, `Esc`, `⌃1`) or a stored shortcut (`cmd+enter`), which is formatted. */
  keys?: string;
  /** A shortcut from the registry (`lib/shortcuts.ts`): shows its main keys. */
  shortcut?: ShortcutId;
  tone?: KbdTone;
  /** Hidden in a narrow pane (two sessions side by side), where the button keeps only its label. */
  hideNarrow?: boolean;
}

/** A keyboard shortcut, as macOS writes it. Buttons show theirs with `Button`'s `kbd` or `shortcut` prop. */
export function Kbd({ keys, shortcut, tone = 'default', hideNarrow = false, className = '', ...rest }: KbdProps) {
  return (
    <kbd className={`shrink-0 font-sans text-meta font-normal ${TONE[tone]} ${hideNarrow ? '@max-[860px]:hidden' : ''} ${className}`} {...rest}>
      {shortcutGlyphs(shortcut ? keysFor(shortcut) : (keys ?? ''))}
    </kbd>
  );
}

/**
 * Alternatives for one action as keycaps, one cap per key (⌘ K, not ⌘K): alternatives separated by "or",
 * sequences by "then", ranges by "to". Screen readers hear the keys as words ("Command, K or Command, Shift, P").
 * `marked` lists the alternatives a filter matched, drawn in the accent.
 */
export function KeyCombo({ combos, marked = [], className = '' }: { combos: readonly string[]; marked?: readonly number[]; className?: string }) {
  const word = 'px-0.5 text-meta text-faint';
  return (
    <span className={`inline-flex flex-wrap items-center justify-end gap-1 ${className}`}>
      <span className="sr-only">{combos.map(spokenKeys).join(' or ')}</span>
      {combos.map((combo, index) => (
        <Fragment key={combo}>
          {index > 0 && (
            <span aria-hidden className={word}>
              or
            </span>
          )}
          <span aria-hidden className="inline-flex items-center gap-0.5">
            {keyPieces(combo).map((piece, i) =>
              'cap' in piece ? (
                <kbd key={i} className={`shrink-0 font-sans text-ui font-normal ${TONE.cap} ${marked.includes(index) ? 'border-accent-ink bg-accent/15 text-accent-ink' : ''}`}>
                  {piece.cap}
                </kbd>
              ) : (
                <span key={i} className={word}>
                  {piece.word}
                </span>
              ),
            )}
          </span>
        </Fragment>
      ))}
    </span>
  );
}
