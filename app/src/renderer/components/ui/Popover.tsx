import { useEffect, useLayoutEffect, useRef, useState, type HTMLAttributes, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { addReturnTarget, focusableIn, MODAL_OPENED_EVENT } from './useModalFocus.ts';

export interface PopoverProps extends Omit<HTMLAttributes<HTMLDivElement>, 'style'> {
  x: number;
  y: number;
  width?: number;
  /** Puts the popover's bottom edge at y instead of its top edge. */
  above?: boolean;
  onClose(): void;
  /** Close on Escape from anywhere (menus). A Select handles Escape itself so it never reaches other listeners. */
  closeOnEscape?: boolean;
  /** Clicks on this element don't count as outside clicks (the button that toggles the popover). */
  anchor?: RefObject<HTMLElement | null>;
  /** The `id` of the popover this one opened from (a submenu): clicks here don't close that one. */
  owner?: string;
  children: ReactNode;
}

/**
 * A floating panel at a screen position, kept on screen. Closes on an outside click, when the window
 * loses focus, when a modal opens over it (a shortcut such as ⌘K while a menu is open) and (optionally)
 * on Escape. The shared base for `Menu` and `Select`. Rendered in `body`, so a parent
 * that stacks its own layer (Settings, a dialog) can't keep it under the toasts.
 */
export function Popover({ x, y, width, above = false, onClose, closeOnEscape = true, anchor, owner, className = '', children, ...rest }: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });

  // Keep the popover on screen, also when it grows after it opened (a menu whose items arrive later).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const place = () => {
      const { innerWidth, innerHeight } = window;
      const top = above ? y - el.offsetHeight : y;
      const next = { left: Math.max(8, Math.min(x, innerWidth - el.offsetWidth - 8)), top: Math.max(8, Math.min(top, innerHeight - el.offsetHeight - 8)) };
      setPosition((current) => (current.left === next.left && current.top === next.top ? current : next));
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(el);
    return () => observer.disconnect();
  }, [x, y, above]);

  // The listeners read the latest props through a ref so they're added once. If they were re-added
  // whenever `onClose` changed, a popover that closes on a click (the project filter) would re-render
  // a nested one (its project menu) mid-dispatch, and the browser would skip the nested one's
  // replaced listener, leaving it open.
  const latest = useRef({ onClose, closeOnEscape });
  useLayoutEffect(() => {
    latest.current = { onClose, closeOnEscape };
  });

  useEffect(() => {
    const close = () => latest.current.onClose();
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (ref.current?.contains(target) || anchor?.current?.contains(target) || inOwnPopover(target)) return;
      close();
    };
    // A click in a popover opened from this one (a submenu, or a submenu's submenu) is inside it.
    const inOwnPopover = (target: Node) => {
      let popover = (target instanceof Element ? target : target.parentElement)?.closest<HTMLElement>('[data-popover]') ?? null;
      while (popover?.dataset.popoverOwner) {
        popover = document.getElementById(popover.dataset.popoverOwner);
        if (popover && popover === ref.current) return true;
      }
      return false;
    };
    const onKey = (event: KeyboardEvent) => {
      if (!latest.current.closeOnEscape || event.key !== 'Escape' || event.defaultPrevented) return;
      // This Escape was the menu's: a dialog under it (or over it) leaves a handled key alone.
      event.preventDefault();
      close();
    };
    // A modal opened over the popover: the popover closes, so it isn't left open behind the modal and
    // the modal's first Escape is its own. Not for a modal the popover holds, or one its button sits in
    // (a dropdown inside a dialog that opened in the same render).
    let closedFor: { modal: HTMLElement; focus: Element | null } | null = null;
    const onModal = (event: Event) => {
      const modal = (event as CustomEvent<HTMLElement>).detail;
      if (!modal || ref.current?.contains(modal) || (anchor?.current && modal.contains(anchor.current))) return;
      closedFor = { modal, focus: document.activeElement };
      // Focus was likely on one of the popover's items, which go with it: the modal gives it back to the button instead.
      addReturnTarget(modal, anchor?.current);
      close();
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    window.addEventListener('blur', close);
    window.addEventListener(MODAL_OPENED_EVENT, onModal);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', close);
      window.removeEventListener(MODAL_OPENED_EVENT, onModal);
      // Whoever owned the popover may have handed focus back to its button as it closed (Unsent
      // messages does); it belongs in the modal, which is now on top.
      if (closedFor?.modal.isConnected && !closedFor.modal.contains(document.activeElement)) {
        const { modal, focus } = closedFor;
        (focus instanceof HTMLElement && focus.isConnected && modal.contains(focus) ? focus : (focusableIn(modal)[0] ?? modal)).focus();
      }
    };
  }, [anchor]);

  return createPortal(
    <div
      ref={ref}
      {...rest}
      style={{ left: position.left, top: position.top, width }}
      // Above the toasts (z-70), so a toast never covers an open menu, and under the tooltips (z-100).
      className={`no-drag fixed z-80 max-h-[70vh] overflow-y-auto rounded-lg border overlay py-1 ${className}`}
      // Lets a dialog see that a menu or dropdown is open, so Escape closes that first.
      data-popover
      data-popover-owner={owner}
    >
      {children}
    </div>,
    document.body,
  );
}
