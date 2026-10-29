/** What a key press means to an open dialog: close it, submit it (⌘↵), or nothing. */
export type DialogKeyAction = 'close' | 'submit' | null;

export interface DialogKeyEvent {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  defaultPrevented: boolean;
  isComposing?: boolean;
}

export interface DialogKeyState {
  /** No other modal is open on top of this one (a confirmation over the action editor). */
  topmost: boolean;
  /** A menu, dropdown or popover is open; Escape closes that first. */
  popoverOpen: boolean;
  /** The dialog has an `onSubmit` for ⌘↵. */
  canSubmit: boolean;
}

/**
 * The Escape and ⌘↵ rules every dialog shares. A key a child already handled (a shortcut being
 * recorded, a dropdown closing) is marked `defaultPrevented` and left alone, as are keys while an
 * input method is composing text.
 */
export function dialogKeyAction(event: DialogKeyEvent, state: DialogKeyState): DialogKeyAction {
  if (event.defaultPrevented || event.isComposing || !state.topmost || state.popoverOpen) return null;
  if (event.key === 'Escape') return 'close';
  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && state.canSubmit) return 'submit';
  return null;
}
