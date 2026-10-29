import { ChevronRight } from 'lucide-react';
import type { HTMLAttributes, MouseEvent, ReactNode } from 'react';
import { CountBadge } from './Pill.tsx';

export type SectionTone = 'neutral' | 'needs-you' | 'working' | 'ok' | 'info' | 'caution' | 'error';

/** The status colours, plus the worktree overview's groups: safe (`ok`), probably done (`info`), keep (`caution`), stale (`error`). */
const TONE: Record<SectionTone, string> = {
  neutral: 'text-faint',
  'needs-you': 'text-warn',
  working: 'text-accent-ink',
  ok: 'text-ok',
  info: 'text-link',
  caution: 'text-caution',
  error: 'text-error',
};

interface SectionHeaderProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  /** The label, written in sentence case; it shows in capitals. */
  children: ReactNode;
  /** The status colour: Needs you (pink), Working (yellow), or the quiet default; the worktree groups have their own. */
  tone?: SectionTone;
  /** A count in a tinted badge; screen readers hear it as ", 3". */
  count?: number | null;
  /** A real `h2` or `h3` (when a section points at it with `aria-labelledby`), or a `role="heading"` span. */
  as?: 'h2' | 'h3';
  /** The heading level for the span form. */
  level?: number;
  /** The heading's id, for `aria-labelledby`. */
  headingId?: string;
  /**
   * Collapsible: the label becomes a button with a chevron. `data` holds its hooks. `leading` puts the chevron in
   * the gutter before the label (the sidebar's sections), always shown and in a neutral colour whatever the tone.
   */
  toggle?: { expanded: boolean; onToggle(event: MouseEvent<HTMLButtonElement>): void; tooltip?: string; leading?: boolean; data?: Record<`data-${string}`, string | boolean | undefined> };
  /** At the end of the row, such as "Select all". */
  action?: ReactNode;
}

/**
 * The small capitals over a group of rows: the sidebar's Needs you, Working, Today and Archived,
 * Home's sections, and the lists in dialogs. Same size and tracking everywhere; the tone is the status.
 */
export function SectionHeader({ children, tone = 'neutral', count, as, level = 2, headingId, toggle, action, className = '', ...rest }: SectionHeaderProps) {
  const counted = count !== undefined && count !== null;
  const label = (
    <>
      {children}
      {counted && <span className="sr-only">, {count}</span>}
      {counted && <CountBadge count={count} status={tone} aria-hidden />}
    </>
  );
  const content = toggle ? (
    <button
      type="button"
      onClick={toggle.onToggle}
      aria-expanded={toggle.expanded}
      data-tooltip={toggle.tooltip}
      className={`group/toggle flex h-full min-w-0 flex-1 items-center gap-1.5 rounded-md text-left uppercase hover:text-text ${toggle.leading ? 'relative' : ''}`}
      {...toggle.data}
    >
      {toggle.leading && (
        <ChevronRight
          size={12}
          className={`absolute right-full mr-0.5 shrink-0 text-faint transition-transform duration-150 group-hover/toggle:text-muted group-focus-visible/toggle:text-muted motion-reduce:transition-none ${toggle.expanded ? 'rotate-90' : ''}`}
          aria-hidden
        />
      )}
      {label}
      {!toggle.leading && <ChevronRight size={13} className={`shrink-0 transition-transform ${toggle.expanded ? 'rotate-90' : ''}`} aria-hidden />}
    </button>
  ) : (
    label
  );
  const heading = 'flex min-w-0 items-center gap-1.5';
  return (
    <div className={`flex min-w-0 items-center gap-1.5 text-meta font-semibold tracking-wider uppercase ${TONE[tone]} ${className}`} {...rest}>
      {as === 'h2' ? (
        <h2 id={headingId} className={`${heading} ${toggle ? 'h-full flex-1' : ''}`}>
          {content}
        </h2>
      ) : as === 'h3' ? (
        <h3 id={headingId} className={`${heading} ${toggle ? 'h-full flex-1' : ''}`}>
          {content}
        </h3>
      ) : (
        <span role="heading" aria-level={level} id={headingId} className={`${heading} ${toggle ? 'h-full flex-1' : ''}`}>
          {content}
        </span>
      )}
      {action}
    </div>
  );
}
