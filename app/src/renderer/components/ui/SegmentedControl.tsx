import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { ariaShortcut, storedShortcut } from '../../lib/shortcuts.ts';
import { stepSegment } from './segments.ts';

export interface Segment<T extends string> {
  value: T;
  /** The visible text, or the accessible name of an icon-only segment. */
  label: string;
  icon?: ReactNode;
  /** Only the icon shows; `label` names it (and is its tooltip unless `tooltip` is set). */
  iconOnly?: boolean;
  /** A count after the label (changed files). Zero or null hides it. */
  badge?: number | null;
  /** The small dot in the corner: green for "running" (terminals running), `link` for "something new" (an answer is ready). */
  dot?: boolean | 'link';
  tooltip?: string;
  /** An accessible name that says more than the label ("Hide changed files, 42 changed"). */
  ariaLabel?: string;
  /** The shortcut that does the same, announced through `aria-keyshortcuts`. */
  kbd?: string;
  disabled?: boolean;
  /** Toggle mode only: the segment opens a panel, so it says `aria-expanded` instead of `aria-pressed`. */
  expanded?: boolean;
  /**
   * Toggle mode, for segments that share one place (side panels that are tabs of the same area): of the ones that are
   * on, `true` is the one showing (an accent bar under it) and `false` one that is on but behind it (softer).
   * Leave it out when the segment is on its own.
   */
  front?: boolean;
  /** data- hooks for the segment's button. */
  data?: Record<`data-${string}`, string | boolean | undefined>;
}

interface Common<T extends string> {
  /** Names the group for screen readers. */
  label: string;
  segments: readonly Segment<T>[];
  /** `sm` 24px (inside a panel's header), `md` 28px (the session header). */
  size?: 'sm' | 'md';
  /** As wide as its container, the segments sharing the width (the sidebar's Recent | Quickest to unblock). */
  fill?: boolean;
  className?: string;
  'data-tooltip'?: string;
  [data: `data-${string}`]: unknown;
}

/** One value out of several: arrow keys move and choose, and the group is one Tab stop. */
interface RadioProps<T extends string> extends Common<T> {
  mode: 'radio';
  value: T;
  onChange(value: T): void;
}

/** Independent on/off segments side by side (Changes | Terminal). */
interface ToggleProps<T extends string> extends Common<T> {
  mode: 'toggle';
  /** The segments that are on. */
  pressed: readonly T[];
  onToggle(value: T): void;
}

const HEIGHT = { sm: 'h-6', md: 'h-7' } as const;

/**
 * Related choices or toggles as one compact control: segments on a `bg-card` track, the active one
 * `bg-selected`. `mode="radio"` picks one value (`role="radiogroup"`); `mode="toggle"` holds
 * independent switches (`aria-pressed`, or `aria-expanded` for a segment that opens a panel).
 */
export function SegmentedControl<T extends string>(props: RadioProps<T> | ToggleProps<T>) {
  const { label, segments, size = 'md', fill = false, className = '', mode } = props;
  const rest = Object.fromEntries(Object.entries(props).filter(([key]) => key.startsWith('data-')));
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const isOn = (segment: Segment<T>) => (props.mode === 'radio' ? props.value === segment.value : props.pressed.includes(segment.value));
  const checkedIndex = props.mode === 'radio' ? segments.findIndex((s) => s.value === props.value) : -1;
  // With nothing chosen, the first segment that can be is the radio group's Tab stop.
  const tabStop = checkedIndex >= 0 ? checkedIndex : segments.findIndex((s) => !s.disabled);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (props.mode !== 'radio') return;
    const current = buttons.current.findIndex((b) => b === document.activeElement);
    const next = stepSegment(event.key, current, segments.map((s) => !s.disabled));
    if (next === null || current === -1) return;
    event.preventDefault();
    buttons.current[next]?.focus();
    props.onChange(segments[next]!.value);
  };

  return (
    <div
      role={mode === 'radio' ? 'radiogroup' : 'group'}
      aria-label={label}
      onKeyDown={onKeyDown}
      // The edge keeps the track visible where card and background are the same colour (white in light mode).
      className={`${fill ? 'flex w-full' : 'inline-flex shrink-0'} items-center gap-0.5 rounded-lg bg-card p-0.5 shadow-[inset_0_0_0_1px_var(--sb-overlay-border)] ${HEIGHT[size]} ${size === 'sm' ? 'text-meta' : 'text-ui'} ${className}`}
      {...rest}
    >
      {segments.map((segment, index) => {
        const on = isOn(segment);
        const behind = on && segment.front === false;
        const aria =
          props.mode === 'radio'
            ? { role: 'radio', 'aria-checked': on, tabIndex: index === tabStop ? 0 : -1 }
            : segment.expanded !== undefined
              ? { 'aria-expanded': segment.expanded }
              : { 'aria-pressed': on };
        return (
          <button
            key={segment.value}
            ref={(el) => {
              buttons.current[index] = el;
            }}
            type="button"
            // A disabled segment with a reason stays hoverable (a disabled button gets no pointer events), so its tooltip can say why.
            disabled={segment.disabled && !segment.tooltip}
            aria-disabled={segment.disabled || undefined}
            onClick={() => {
              if (segment.disabled) return;
              if (props.mode === 'radio') props.onChange(segment.value);
              else props.onToggle(segment.value);
            }}
            aria-label={segment.ariaLabel ?? (segment.iconOnly ? segment.label : undefined)}
            aria-keyshortcuts={segment.kbd ? ariaShortcut(storedShortcut(segment.kbd)) : undefined}
            data-tooltip={segment.tooltip ?? (segment.iconOnly ? segment.label : undefined)}
            className={`relative flex h-full ${fill ? 'min-w-0 flex-auto' : 'shrink-0'} items-center justify-center gap-1 rounded-md px-1.5 whitespace-nowrap disabled:opacity-50 aria-disabled:cursor-default aria-disabled:opacity-50 ${behind ? 'bg-selected/40 text-muted hover:text-text' : on ? 'bg-selected text-text' : 'text-muted enabled:not-aria-disabled:hover:bg-border/50 enabled:not-aria-disabled:hover:text-text'}`}
            data-segment-front={on && segment.front !== undefined ? segment.front : undefined}
            {...aria}
            {...segment.data}
          >
            {segment.icon}
            {!segment.iconOnly && <span className={fill ? 'truncate' : undefined}>{segment.label}</span>}
            {segment.badge ? <span className="text-meta tabular-nums">{segment.badge}</span> : null}
            {segment.dot && <span className={`absolute top-1 right-1 size-1.5 rounded-full ${segment.dot === 'link' ? 'bg-link' : 'bg-ok'}`} aria-hidden />}
            {on && segment.front === true && <span className="absolute inset-x-1.5 bottom-0 h-0.5 rounded-full bg-accent-ink" aria-hidden />}
          </button>
        );
      })}
    </div>
  );
}
