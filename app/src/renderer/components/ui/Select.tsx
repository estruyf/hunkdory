import { Check, ChevronDown } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Popover } from './Popover.tsx';
import { nextTypeaheadIndex } from './typeahead.ts';

export interface SelectOption<T extends string> {
  value: T;
  label: string;
  icon?: ReactNode;
  /** Shown in the list only, after the label. */
  hint?: string;
  disabled?: boolean;
}

export interface SelectProps<T extends string> {
  value: T;
  options: Array<SelectOption<T>>;
  onChange(value: T): void;
  disabled?: boolean;
  /** Accessible name, and the tooltip on the button. */
  label: string;
  /** Extra tooltip text; defaults to the label. */
  tooltip?: string;
  /** Classes for the button (size, border, colours). */
  className?: string;
  /** Minimum width of the list; it is at least as wide as the button. */
  menuWidth?: number;
  /** Shown when the value matches no option. */
  placeholder?: string;
  /** Extra attributes for the button, e.g. `{ 'data-model-select': true }` for the smoke test. */
  dataAttrs?: Record<`data-${string}`, string | boolean | undefined>;
  /** An option was highlighted in the open list, by the pointer or the keys (not when the list opens): to preview it, such as playing a sound. */
  onHighlight?(value: T): void;
}

/**
 * A themed dropdown in place of the native `<select>`: a `combobox` button that opens a `listbox`
 * popover. Arrow keys, Home/End, type-ahead, Enter/Space choose, Escape and Tab close. The button
 * carries `data-value` so the smoke test can read the current choice.
 */
export function Select<T extends string>({ value, options, onChange, disabled, label, tooltip, className = '', menuWidth = 180, placeholder, dataAttrs, onHighlight }: SelectProps<T>) {
  const id = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState<{ x: number; y: number; width: number; above: boolean } | null>(null);
  const [active, setActive] = useState(0);
  const typed = useRef({ text: '', at: 0 });
  const selectedIndex = options.findIndex((o) => o.value === value);
  const selected = options[selectedIndex];

  const close = useCallback((refocus = true) => {
    setOpen(null);
    if (refocus) buttonRef.current?.focus();
  }, []);
  const closeQuietly = useCallback(() => close(false), [close]);

  const show = () => {
    const button = buttonRef.current;
    if (!button || disabled) return;
    const rect = button.getBoundingClientRect();
    // Open upwards when there isn't room below (the status bar sits at the bottom of the window).
    const above = window.innerHeight - rect.bottom < Math.min(320, options.length * 26 + 16) && rect.top > window.innerHeight - rect.bottom;
    setActive(Math.max(0, selectedIndex));
    setOpen({ x: rect.left, y: above ? rect.top - 4 : rect.bottom + 4, width: Math.max(rect.width, menuWidth), above });
  };

  // Focus the list when it opens so keys go to it (and Escape never reaches the composer).
  useEffect(() => {
    if (open) listRef.current?.focus();
  }, [open]);
  useEffect(() => {
    if (open) listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);
  // A disabled select can't stay open.
  useEffect(() => {
    if (disabled) setOpen(null);
  }, [disabled]);

  const choose = (index: number) => {
    const option = options[index];
    if (!option || option.disabled) return;
    close();
    if (option.value !== value) onChange(option.value);
  };

  const highlight = (index: number) => {
    if (index === active) return;
    setActive(index);
    const option = options[index];
    if (option && !option.disabled) onHighlight?.(option.value);
  };

  const move = (from: number, step: number) => {
    for (let i = 1; i <= options.length; i++) {
      const next = (from + step * i + options.length * i) % options.length;
      if (!options[next]?.disabled) return next;
    }
    return from;
  };

  const onListKey = (event: KeyboardEvent) => {
    // Handled here, so dialogs and the composer never see these keys.
    event.stopPropagation();
    if (event.key === 'Escape') return (event.preventDefault(), close());
    if (event.key === 'Tab') return close();
    if (event.key === 'ArrowDown') return (event.preventDefault(), highlight(move(active, 1)));
    if (event.key === 'ArrowUp') return (event.preventDefault(), highlight(move(active, -1)));
    if (event.key === 'Home') return (event.preventDefault(), highlight(move(-1, 1)));
    if (event.key === 'End') return (event.preventDefault(), highlight(move(options.length, -1)));
    if (event.key === 'Enter' || event.key === ' ') return (event.preventDefault(), choose(active));
    if (event.key.length === 1 && !event.metaKey && !event.ctrlKey) {
      const now = Date.now();
      typed.current = { text: (now - typed.current.at > 700 ? '' : typed.current.text) + event.key, at: now };
      const next = nextTypeaheadIndex(options, typed.current.text, active);
      if (next !== -1) highlight(next);
    }
  };

  const onButtonKey = (event: KeyboardEvent) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      show();
    }
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open !== null}
        aria-controls={open ? id : undefined}
        aria-label={label}
        data-tooltip={tooltip ?? label}
        data-value={value}
        disabled={disabled}
        onClick={() => (open ? close() : show())}
        onKeyDown={onButtonKey}
        className={`no-drag inline-flex min-w-0 items-center gap-1.5 text-left disabled:opacity-50 ${className}`}
        {...dataAttrs}
      >
        {selected?.icon && <span className="flex shrink-0 items-center">{selected.icon}</span>}
        <span className="min-w-0 flex-1 truncate">{selected?.label ?? placeholder ?? value}</span>
        <ChevronDown size={12} className="shrink-0 opacity-60" />
      </button>
      {open && (
        <Popover x={open.x} y={open.y} above={open.above} width={open.width} onClose={closeQuietly} closeOnEscape={false} anchor={buttonRef}>
          <div
            ref={listRef}
            id={id}
            role="listbox"
            aria-label={label}
            tabIndex={-1}
            aria-activedescendant={`${id}-${active}`}
            onKeyDown={onListKey}
            className="outline-none"
            data-select-list
          >
            {options.map((option, i) => (
              <div
                key={option.value}
                id={`${id}-${i}`}
                role="option"
                aria-selected={option.value === value}
                aria-disabled={option.disabled || undefined}
                data-index={i}
                data-option-value={option.value}
                onMouseEnter={() => !option.disabled && highlight(i)}
                onClick={() => choose(i)}
                className={`flex items-center gap-2 px-3 py-1 text-ui ${option.disabled ? 'opacity-40' : ''} ${i === active ? 'bg-accent/15 text-text' : 'text-text'}`}
              >
                {option.icon && <span className="flex w-4 shrink-0 justify-center text-muted">{option.icon}</span>}
                {/* With a hint, the label keeps its width and the hint truncates instead. */}
                <span className={option.hint ? 'max-w-full shrink-0 truncate' : 'min-w-0 flex-1 truncate'}>{option.label}</span>
                {option.hint && <span className="min-w-0 flex-1 truncate text-right text-meta text-faint">{option.hint}</span>}
                <Check size={12} className={`shrink-0 text-accent-ink ${option.value === value ? '' : 'invisible'}`} />
              </div>
            ))}
          </div>
        </Popover>
      )}
    </>
  );
}
