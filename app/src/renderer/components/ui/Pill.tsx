import type { HTMLAttributes, MouseEventHandler, ReactNode, Ref } from 'react';
import { ariaShortcut, storedShortcut } from '../../lib/shortcuts.ts';
import { pillClass, type PillTone } from './buttonStyles.ts';
import { Kbd } from './Kbd.tsx';

interface PillProps extends Omit<HTMLAttributes<HTMLElement>, 'onClick'> {
  /** `default`, `muted` (quiet, on a card), `accent` (at a limit), `ok` (background work, clean), `warn` (needs you or over a limit), `caution` (look before it goes), `error` (something failed), `link` (an open pull request), `count` (the number next to a group heading). */
  tone?: PillTone;
  /** A button when given, otherwise a label. */
  onClick?: MouseEventHandler<HTMLButtonElement>;
  /** For pills that add something ("+ Add action"). */
  dashed?: boolean;
  /** A pill that toggles something open, while it is open. */
  selected?: boolean;
  /** Let it shrink and truncate its label rather than keep its width. */
  shrink?: boolean;
  icon?: ReactNode;
  /** Its shortcut, shown after the label (hidden in a narrow pane) and announced through `aria-keyshortcuts`. */
  kbd?: string;
  disabled?: boolean;
  'data-tooltip'?: string;
  ref?: Ref<HTMLButtonElement>;
}

/** A small rounded chip: project actions and the task strip above the message box, or a label. */
export function Pill({ tone = 'default', onClick, dashed = false, selected = false, shrink = false, icon, kbd, disabled, className = '', children, ref, ...rest }: PillProps) {
  const look = `${pillClass({ tone, interactive: !!onClick, dashed, selected, shrink })} ${className}`;
  const content = (
    <>
      {icon}
      {children}
      {kbd && <Kbd keys={kbd} tone="plain" hideNarrow aria-hidden />}
    </>
  );
  if (!onClick) {
    return (
      <span className={look} {...rest}>
        {content}
      </span>
    );
  }
  return (
    <button ref={ref} type="button" onClick={onClick} disabled={disabled} aria-keyshortcuts={kbd ? ariaShortcut(storedShortcut(kbd)) : undefined} className={look} {...rest}>
      {content}
    </button>
  );
}

const COUNT_TINT = { 'needs-you': 'bg-warn/15', working: 'bg-accent/20', neutral: 'bg-border/60', ok: 'bg-ok/15', info: 'bg-link/15', caution: 'bg-caution/15', error: 'bg-error/15' } as const;

/**
 * The count next to a group heading (Needs you, Working, Archived), tinted like the heading's status.
 * Where the heading says the number another way (`sr-only`), pass `aria-hidden`.
 */
export function CountBadge({ count, status = 'neutral', className = '', ...rest }: { count: number; status?: keyof typeof COUNT_TINT; className?: string; 'aria-hidden'?: boolean }) {
  return (
    <Pill tone="count" className={`${COUNT_TINT[status]} ${className}`} {...rest}>
      {count}
    </Pill>
  );
}
