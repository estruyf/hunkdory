interface Rect {
  left: number;
  top: number;
  bottom: number;
  width: number;
}
interface Size {
  width: number;
  height: number;
}

const GAP = 6;
const MARGIN = 8;

/**
 * Where a tooltip goes: centred below its target, or above when there's no room below, and always
 * kept inside the window with a small margin. `prefer: 'above'` turns that round, for a target near
 * the bottom of the conversation, where the message box would cover what opens below.
 */
export function placeTooltip(target: Rect, tip: Size, viewport: Size, prefer: 'below' | 'above' = 'below'): { left: number; top: number } {
  const centred = target.left + target.width / 2 - tip.width / 2;
  const left = Math.max(MARGIN, Math.min(centred, viewport.width - tip.width - MARGIN));
  const below = target.bottom + GAP;
  const above = target.top - GAP - tip.height;
  const fitsBelow = below + tip.height + MARGIN <= viewport.height;
  const top = prefer === 'above' ? (above >= MARGIN ? above : fitsBelow ? below : MARGIN) : fitsBelow ? below : Math.max(MARGIN, above);
  return { left: Math.round(left), top: Math.round(top) };
}

/**
 * Where a tooltip goes beside its target (the minimal sidebar's rows): to the right, centred on it
 * vertically, kept inside the window.
 */
export function placeTooltipRight(target: Rect & { right: number; height: number }, tip: Size, viewport: Size): { left: number; top: number } {
  const left = Math.min(target.right + GAP, viewport.width - tip.width - MARGIN);
  const centred = target.top + target.height / 2 - tip.height / 2;
  const top = Math.max(MARGIN, Math.min(centred, viewport.height - tip.height - MARGIN));
  return { left: Math.round(left), top: Math.round(top) };
}
