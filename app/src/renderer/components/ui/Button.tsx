import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';
import { ariaKeysFor, ariaShortcut, keysFor, shortcutGlyphs, storedShortcut, type ShortcutId } from '../../lib/shortcuts.ts';
import { buttonClass, type ButtonSize, type ButtonVariant } from './buttonStyles.ts';
import { Kbd } from './Kbd.tsx';

interface BaseProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** `primary`: the one yellow action per area. `secondary` (default): Cancel, Close, Choose…. `quiet`: toolbar icons and inline controls. `danger`: deletes or reverts. `side`: Ask about this session, outlined in blue (`filled` for the panel's send button). */
  variant?: ButtonVariant;
  /** `sm` 24px, `md` 28px (toolbars, dialogs), `lg` 32px (cards, the message box, a view's main action). */
  size?: ButtonSize;
  /** Shown before the label. */
  icon?: ReactNode;
  /** The shortcut that does the same (`⌘↵`, `Esc`, or a stored `cmd+enter`): shown in a `<kbd>` and announced through `aria-keyshortcuts`. */
  kbd?: string;
  /** A shortcut from the registry (`lib/shortcuts.ts`) that does the same: shown like `kbd`, and every alternative announced. */
  shortcut?: ShortcutId;
  /** Hide the shortcut in a narrow pane, where the label alone has to fit. */
  kbdHideNarrow?: boolean;
  /** Danger: the solid red button that confirms a destructive dialog. Side: the solid blue send button of the Ask panel. */
  filled?: boolean;
  /** A circle rather than a rounded square (with `iconOnly`). */
  round?: boolean;
  /**
   * Quiet: shown as pressed or current (an open panel, the view you're on); set `aria-pressed` or `aria-current` yourself.
   * Secondary: highlighted from the keyboard, as the last choice under a list (Add project's Choose folder…).
   * Side: pressed, while the Ask panel is open.
   */
  selected?: boolean;
  /** Only for `SplitButton`: which half of it this is. */
  segment?: 'main' | 'menu';
  'data-tooltip'?: string;
  ref?: Ref<HTMLButtonElement>;
}

/** An icon-only button has no visible label, so it must name itself; the name is its tooltip too. */
type ButtonProps = (BaseProps & { iconOnly: true; 'aria-label': string }) | (BaseProps & { iconOnly?: false });

/**
 * Every button in the app. Variants and sizes follow AGENTS.md (Design system); `className` is for
 * layout around it (`ml-auto`, `w-full`, `min-w-0`), not for changing its look.
 */
export function Button({ variant = 'secondary', size = 'md', icon, iconOnly = false, kbd: keys, shortcut, kbdHideNarrow = false, filled = false, selected = false, round = false, segment, className = '', type = 'button', children, ...rest }: ButtonProps) {
  const kbd = shortcut ? keysFor(shortcut) : keys;
  const glyphs = kbd ? shortcutGlyphs(kbd) : null;
  const label = rest['aria-label'];
  const tooltip = rest['data-tooltip'] ?? (iconOnly && label ? `${label}${glyphs ? ` (${glyphs})` : ''}` : undefined);
  return (
    <button
      type={type}
      aria-keyshortcuts={shortcut ? ariaKeysFor(shortcut) : kbd ? ariaShortcut(storedShortcut(kbd)) : undefined}
      {...rest}
      data-tooltip={tooltip}
      data-selected={selected && variant === 'secondary' ? true : undefined}
      className={`${buttonClass({ variant, size, iconOnly, filled, selected, segment, round })} ${className}`}
    >
      {icon}
      {/* For an icon-only button: decoration such as a status dot, not a label. */}
      {children}
      {!iconOnly && kbd && <Kbd keys={kbd} tone={variant === 'primary' ? 'on-accent' : 'default'} hideNarrow={kbdHideNarrow} aria-hidden />}
    </button>
  );
}
