import { X } from 'lucide-react';
import { useEffect, useId, useRef, type HTMLAttributes, type ReactNode, type RefObject } from 'react';
import { Button } from './Button.tsx';
import { dialogKeyAction } from './dialogKeys.ts';
import { isTopModal, useModalFocus } from './useModalFocus.ts';

const WIDTH = { sm: 'w-[420px]', md: 'w-[560px]', palette: 'w-[640px]', 'palette-wide': 'w-[680px]', sheet: 'w-[880px]', lg: 'w-[900px]', full: 'w-[1200px]' } as const;

interface DialogProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title' | 'role' | 'onSubmit'> {
  /** The heading, and the dialog's accessible name. */
  title: ReactNode;
  /** A line under the title; it also describes the dialog. */
  subtitle?: ReactNode;
  /** `sm` 420px (confirmations), `md` 560px, `palette` 640px (the command palette; `palette-wide` 680px for its prompt step), `sheet` 880px (the shortcuts sheet), `lg` 900px, `full` 1200px and 88% of the window tall (a file preview); never wider than 92% of the window. */
  width?: keyof typeof WIDTH;
  /** `top` for dialogs whose height changes as you type (search, filters), so they don't jump around. */
  placement?: 'center' | 'top';
  onClose(): void;
  /** What ⌘↵ does (save, commit). */
  onSubmit?(): void;
  /** The buttons at the bottom right: Cancel, then the primary action. */
  footer?: ReactNode;
  /** The bottom left: a danger action such as Delete, or a status line. */
  footerStart?: ReactNode;
  /** Before the title (an icon). */
  icon?: ReactNode;
  /** Small controls next to the close button (Refresh, a profile badge). */
  headerActions?: ReactNode;
  /** What gets focus first; otherwise an `autoFocus` field, or the first control. */
  initialFocus?: RefObject<HTMLElement | null>;
  /** `alertdialog` for a confirmation that interrupts. */
  role?: 'dialog' | 'alertdialog';
  /** Whether a click on the scrim closes it (default). */
  dismissable?: boolean;
  /** No header: the content brings its own (a search field). `title` is still its accessible name. */
  bare?: boolean;
  /** A body without padding, for lists and panes that reach the edges. */
  flush?: boolean;
  children?: ReactNode;
}

/**
 * The shell of every modal: a scrim, a centred panel on the overlay surface, a header with the title
 * and a close button, a scrolling body and a footer. Escape closes it (unless a menu inside is open,
 * or a child already handled the key, such as a shortcut being recorded), and only the dialog on top
 * reacts when one opens another. Tab stays inside, and focus goes back where it was on close.
 */
export function Dialog({
  title,
  subtitle,
  width = 'md',
  placement = 'center',
  onClose,
  onSubmit,
  footer,
  footerStart,
  icon,
  headerActions,
  initialFocus,
  role = 'dialog',
  dismissable = true,
  bare = false,
  flush = false,
  className = '',
  children,
  ...rest
}: DialogProps) {
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  // The latest handlers, so the key listener is added once rather than on every render.
  const handlers = useRef({ onClose, onSubmit });
  handlers.current = { onClose, onSubmit };

  useEffect(() => {
    initialFocus?.current?.focus();
  }, [initialFocus]);
  useModalFocus(ref);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const action = dialogKeyAction(event, {
        topmost: isTopModal(ref.current),
        popoverOpen: document.querySelector('[data-popover]') !== null,
        canSubmit: handlers.current.onSubmit !== undefined,
      });
      if (!action) return;
      // This press is ours: Settings and the message box behind leave a handled key alone.
      event.preventDefault();
      if (action === 'close') handlers.current.onClose();
      else handlers.current.onSubmit?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // A confirmation reads as one card; larger dialogs separate the header and footer from what scrolls.
  const divided = width !== 'sm';
  const hasBody = children !== undefined && children !== null && children !== false;
  return (
    <div
      className={`no-drag fixed inset-0 z-[60] flex justify-center bg-scrim ${placement === 'top' ? 'items-start pt-[12vh]' : 'items-center'}`}
      onMouseDown={(e) => dismissable && e.target === e.currentTarget && onClose()}
    >
      <div
        ref={ref}
        role={role}
        aria-modal="true"
        aria-label={bare && typeof title === 'string' ? title : undefined}
        aria-labelledby={bare ? undefined : `${id}-title`}
        aria-describedby={subtitle && !bare ? `${id}-subtitle` : undefined}
        tabIndex={-1}
        className={`flex ${width === 'full' ? 'h-[88vh] max-h-[88vh]' : placement === 'top' ? 'max-h-[76vh]' : 'max-h-[85vh]'} ${WIDTH[width]} max-w-[92vw] flex-col overflow-hidden rounded-xl border overlay outline-none ${className}`}
        {...rest}
      >
        {!bare && (
          <header className={`flex shrink-0 items-start gap-3 px-5 ${divided ? 'border-b border-edge py-3.5' : 'pt-5'}`}>
            {icon && <span className="mt-0.5 shrink-0">{icon}</span>}
            <div className="min-w-0 flex-1">
              <h2 id={`${id}-title`} className="text-title font-semibold">
                {title}
              </h2>
              {subtitle && (
                <div id={`${id}-subtitle`} className="mt-0.5 text-ui text-muted">
                  {subtitle}
                </div>
              )}
            </div>
            <div className="-mt-0.5 -mr-1.5 flex shrink-0 items-center gap-1">
              {headerActions}
              <Button variant="quiet" size="sm" iconOnly icon={<X size={14} aria-hidden />} kbd="Esc" aria-label="Close" onClick={onClose} />
            </div>
          </header>
        )}
        {hasBody && <div className={`flex min-h-0 flex-1 flex-col overflow-y-auto ${flush ? '' : divided ? 'px-5 py-4' : 'px-5 pt-3'}`}>{children}</div>}
        {(footer || footerStart) && (
          <footer className={`flex shrink-0 items-center gap-2 px-5 ${divided ? 'border-t border-edge py-3' : 'pt-5 pb-5'}`}>
            {footerStart}
            <span className="flex-1" />
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}
