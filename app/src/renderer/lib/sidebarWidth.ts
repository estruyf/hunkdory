/** What ⌘B collapses an open sidebar to (Settings › Review defaults). */
export type SidebarCollapsed = 'minimal' | 'closed';

/** Sidebar width limits: wide enough for titles at the minimum, and the review keeps its room at the maximum. */
export const SIDEBAR_DEFAULT_WIDTH = 320;
export const SIDEBAR_MIN_WIDTH = 240;
export const SIDEBAR_MAX_WIDTH = 520;
/** The minimal rail: a project icon per branch, wide enough to hold the traffic lights. */
export const SIDEBAR_RAIL_WIDTH = 88;
/** Dragged narrower than this, the sidebar closes; between this and SNAP_OPEN it becomes the rail. */
export const SNAP_CLOSED = 110;
/** Dragged wider than this, the sidebar opens (at SIDEBAR_MIN_WIDTH until the pointer passes it). */
export const SNAP_OPEN = 200;
/** One press of ← or → on the resize edge. */
export const SIDEBAR_KEY_STEP = 16;

/** Open (the full list), minimal (the rail) or closed (not shown). */
export type SidebarState = 'open' | 'minimal' | 'closed';
export const SIDEBAR_STATES: readonly SidebarState[] = ['open', 'minimal', 'closed'];

/** Rounds and clamps a dragged or stored width; anything that isn't a finite number falls back to the default. */
export function clampSidebarWidth(width: number): number {
  if (!Number.isFinite(width)) return SIDEBAR_DEFAULT_WIDTH;
  return Math.round(Math.min(Math.max(width, SIDEBAR_MIN_WIDTH), SIDEBAR_MAX_WIDTH));
}

/** A stored state, or open for anything else. */
export const parseSidebarState = (value: unknown): SidebarState => (SIDEBAR_STATES.includes(value as SidebarState) ? (value as SidebarState) : 'open');

/** Where the sidebar is and how wide it shows (0 closed, the rail's width minimal, the open width open). */
export interface SidebarSnap {
  state: SidebarState;
  width: number;
}

/**
 * Where a drag of the edge to `dragX` (the width the pointer asks for) lands. The edge never stops in
 * between: under 110 closed, to 200 the rail, to 240 open at the minimum width, then open at that width.
 */
export function snapWidth(dragX: number): SidebarSnap {
  if (!(dragX >= SNAP_CLOSED)) return { state: 'closed', width: 0 };
  if (dragX < SNAP_OPEN) return { state: 'minimal', width: SIDEBAR_RAIL_WIDTH };
  return { state: 'open', width: clampSidebarWidth(dragX) };
}

/**
 * Where a drag that started on the rail (or closed) lands. Opening goes back to a width you chose before:
 * the minimum width, or the last open width when the pointer is closer to it.
 */
export function snapFromCollapsed(dragX: number, lastOpenWidth: number): SidebarSnap {
  const snap = snapWidth(dragX);
  if (snap.state !== 'open') return snap;
  const last = clampSidebarWidth(lastOpenWidth);
  return { state: 'open', width: Math.abs(dragX - last) < Math.abs(dragX - SIDEBAR_MIN_WIDTH) ? last : SIDEBAR_MIN_WIDTH };
}

/** How wide the sidebar shows in a state, given the open width it keeps. */
export function shownWidth(state: SidebarState, openWidth: number): number {
  return state === 'open' ? clampSidebarWidth(openWidth) : state === 'minimal' ? SIDEBAR_RAIL_WIDTH : 0;
}

/**
 * The room the main area keeps next to the open sidebar, in CSS pixels: enough for a step's header and
 * a readable diff.
 */
export const MAIN_MIN_WIDTH = 560;

/**
 * How the sidebar shows in a window `viewportWidth` CSS pixels wide (fewer when zoomed in). Open, it
 * narrows so the main area keeps MAIN_MIN_WIDTH, and when even its minimum width doesn't fit it shows
 * as the rail. The rail and closed stay as they are. Only what shows changes: the saved state and
 * width come back as the window grows.
 */
export function fitSidebar(state: SidebarState, openWidth: number, viewportWidth: number): SidebarSnap {
  const width = shownWidth(state, openWidth);
  if (state !== 'open' || !Number.isFinite(viewportWidth)) return { state, width };
  const room = Math.floor(viewportWidth - MAIN_MIN_WIDTH);
  if (room < SIDEBAR_MIN_WIDTH) return { state: 'minimal', width: SIDEBAR_RAIL_WIDTH };
  return { state: 'open', width: Math.min(width, room) };
}

/**
 * ← or → on the resize edge. Open, they change the width in steps; ← at the minimum goes to the rail and
 * again to closed, → comes back the same way and opens at the last open width. The open width only
 * changes while open.
 */
export function stepState(current: { state: SidebarState; width: number }, direction: 'left' | 'right'): { state: SidebarState; width: number } {
  const width = clampSidebarWidth(current.width);
  if (current.state === 'open') {
    if (direction === 'right') return { state: 'open', width: clampSidebarWidth(width + SIDEBAR_KEY_STEP) };
    return width <= SIDEBAR_MIN_WIDTH ? { state: 'minimal', width } : { state: 'open', width: clampSidebarWidth(width - SIDEBAR_KEY_STEP) };
  }
  if (current.state === 'minimal') return { state: direction === 'left' ? 'closed' : 'open', width };
  return { state: direction === 'right' ? 'minimal' : 'closed', width };
}

/** ⌘B and the header's toggle: open goes to what "collapsed" means in Settings, anything else opens. */
export const toggledState = (state: SidebarState, collapsed: SidebarCollapsed): SidebarState => (state === 'open' ? collapsed : 'open');
