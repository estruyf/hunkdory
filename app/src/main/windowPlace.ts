// Opening the window where you left it, unless that place is gone: a screen you unplugged, or a smaller one.

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The size and position of the window when it isn't maximized, and whether it was. */
export interface WindowPlace extends Rect {
  maximized: boolean;
}

/** How much of the top bar has to be on a screen for you to get hold of it and drag the window. */
const GRAB = { width: 100, height: 40 };

const holdsTopBar = (w: Rect, s: Rect) =>
  Math.min(w.x + w.width, s.x + s.width) - Math.max(w.x, s.x) >= GRAB.width && w.y >= s.y && w.y + GRAB.height <= s.y + s.height;

/**
 * The bounds to open with. On a screen it can be reached on it keeps its place, shrunk to fit if that
 * screen got smaller. Otherwise it goes on the primary screen, without a position so it opens centred.
 */
export function restoredBounds(saved: Rect, screens: Rect[], primary: Rect): Partial<Rect> {
  const home = screens.find((s) => holdsTopBar(saved, s));
  const fit = home ?? primary;
  const width = Math.min(saved.width, fit.width);
  const height = Math.min(saved.height, fit.height);
  if (!home) return { width, height };
  return { x: width < saved.width ? home.x : saved.x, y: height < saved.height ? home.y : saved.y, width, height };
}
