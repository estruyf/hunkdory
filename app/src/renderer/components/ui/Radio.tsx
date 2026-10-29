import type { KeyboardEvent, ReactNode } from 'react';

/** The themed radio dot. */
export function RadioMark({ checked, className = '' }: { checked: boolean; className?: string }) {
  return (
    <span aria-hidden className={`flex size-3.5 shrink-0 items-center justify-center rounded-full border transition-colors ${checked ? 'border-accent-ink bg-accent' : 'border-faint bg-card'} ${className}`}>
      {checked && <span className="size-1.5 rounded-full bg-on-accent" />}
    </span>
  );
}

/**
 * One option of a `RadioGroup` (`role="radio"`). Only the checked one is in the tab order; while none
 * is checked, pass `tabbable` on the first so the group can still be reached with Tab.
 */
export function Radio({
  checked,
  onSelect,
  disabled,
  tabbable,
  label,
  children,
  className = '',
  dataAttrs,
}: {
  checked: boolean;
  onSelect(): void;
  disabled?: boolean;
  tabbable?: boolean;
  /** Accessible name when the visible text alone is ambiguous (several "Default" radios on one page). */
  label?: string;
  children: ReactNode;
  className?: string;
  dataAttrs?: Record<`data-${string}`, string | boolean | undefined>;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      aria-label={label}
      tabIndex={checked || tabbable ? 0 : -1}
      disabled={disabled}
      onClick={onSelect}
      className={`inline-flex items-start gap-2 text-left disabled:opacity-50 ${className}`}
      {...dataAttrs}
    >
      <RadioMark checked={checked} className="mt-px" />
      {/* Takes the row's width, so a radio as wide as its group can put something on the right. */}
      <span className="min-w-0 flex-1">{children}</span>
    </button>
  );
}

/**
 * `role="radiogroup"` with the native keyboard model: arrow keys move to and pick the next option.
 * Works for `Radio` and for `Choice` cards, since both render `role="radio"` buttons.
 */
export function RadioGroup({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    const radios = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role=radio]:not(:disabled)')];
    const current = radios.indexOf(document.activeElement as HTMLButtonElement);
    if (current === -1) return;
    event.preventDefault();
    const next = radios[(current + step + radios.length) % radios.length]!;
    next.focus();
    next.click();
  };
  return (
    <div role="radiogroup" aria-label={label} onKeyDown={onKeyDown} className={className}>
      {children}
    </div>
  );
}
