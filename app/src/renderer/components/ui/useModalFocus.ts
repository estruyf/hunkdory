import { useEffect, useState, type RefObject } from 'react';

// Elements taken out of the Tab order (tabindex="-1", such as rows driven by arrow keys) don't count.
const FOCUSABLE = ['button:not(:disabled)', '[href]', 'input:not(:disabled)', 'textarea:not(:disabled)', 'select:not(:disabled)', '[tabindex]', '[contenteditable="true"]'].map((s) => `${s}:not([tabindex="-1"])`).join(', ');

/**
 * Open modals, innermost last: only the top one traps Tab. `returnTo` is where focus goes when it
 * closes, first one still on the page wins: its opener, then (when the opener was inside another
 * modal, such as the command palette's field) where that modal would give focus back.
 */
const stack: { root: HTMLElement; returnTo: HTMLElement[] }[] = [];

/** Whether `root` is the modal on top, the one keys such as Escape belong to. */
export const isTopModal = (root: HTMLElement | null) => root !== null && stack[stack.length - 1]?.root === root;

/**
 * Sent on `window` when a modal opens, with its root as `detail`. Menus and popovers open under it
 * close (`Popover`), so they don't stay behind it and take its Escape.
 */
export const MODAL_OPENED_EVENT = 'hunkdory:modal-opened';

/**
 * One more place for an open modal to give focus back to, after the ones it has: a menu that closed
 * as the modal opened offers its button, as the menu item that had focus goes with it.
 */
export function addReturnTarget(root: HTMLElement, el: HTMLElement | null | undefined) {
  if (el) stack.find((entry) => entry.root === root)?.returnTo.push(el);
}

/** Where a modal opened now gives focus back to: the focused element, then the places of the modal it sits in. */
function returnTargets(): HTMLElement[] {
  if (typeof document === 'undefined') return [];
  const opener = document.activeElement as HTMLElement | null;
  if (!opener) return [];
  const outer = stack.findLast((entry) => entry.root.contains(opener));
  return [opener, ...(outer?.returnTo ?? [])];
}

/** The elements Tab can reach inside `root`, in document order. */
export function focusableIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => !el.closest('[inert], [aria-hidden="true"]') && el.getClientRects().length > 0);
}

/**
 * Focus handling for a modal dialog: Tab and ⇧Tab stay inside it, and when it closes focus goes back
 * to whatever had it before (the button that opened it), so keyboard and VoiceOver users don't land
 * at the top of the window. The dialog keeps choosing its own first focus (a field or default button);
 * if it doesn't, the first control inside gets it.
 */
export function useModalFocus(ref: RefObject<HTMLElement | null>) {
  // Read during the first render, before the dialog's own effects move focus into it. A dialog run
  // from the palette renders while the palette is still open, so its opener is the palette's field,
  // gone by the time the dialog closes: the palette's own opener (the message box) is next in line.
  const [returnTo] = useState(returnTargets);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    if (!root.contains(document.activeElement)) (focusableIn(root)[0] ?? root).focus();

    stack.push({ root, returnTo });
    window.dispatchEvent(new CustomEvent<HTMLElement>(MODAL_OPENED_EVENT, { detail: root }));
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || event.defaultPrevented || !isTopModal(root)) return;
      const items = focusableIn(root);
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const current = document.activeElement as HTMLElement | null;
      if (!current || !root.contains(current)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && current === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && current === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      const at = stack.findIndex((entry) => entry.root === root);
      if (at >= 0) stack.splice(at, 1);
      // Only hand focus back when nothing else claimed it (another dialog, or a click elsewhere).
      const active = document.activeElement;
      if (active && active !== document.body && !root.contains(active)) return;
      returnTo.find((el) => el.isConnected && el !== document.body)?.focus();
    };
  }, [ref, returnTo]);
}
