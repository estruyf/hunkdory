// The sidebar's state: open (at the width you dragged it to) or closed, as Switchboard keeps it. While you
// review a branch it is out of the way: the review has one job, and Inbox in the header takes you back.
import { create } from 'zustand';
import { clampSidebarWidth, fitSidebar, SIDEBAR_DEFAULT_WIDTH, type SidebarSnap, type SidebarState } from '../lib/sidebarWidth.ts';

interface Stored {
  width: number;
  state: SidebarState;
}

const KEY = 'ui.sidebar';

function load(): Stored {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Stored> | null;
    // The rail is gone: a sidebar saved as the rail comes back closed.
    return { width: clampSidebarWidth(Number(raw?.width)), state: raw?.state === 'open' || !raw ? 'open' : 'closed' };
  } catch {
    return { width: SIDEBAR_DEFAULT_WIDTH, state: 'open' };
  }
}

interface SidebarStore extends Stored {
  /** The window's width in CSS pixels; a narrow window closes the sidebar so the view keeps its room. */
  viewport: number;
  /** You are reviewing a branch (a step, a skim folder, Finish): the sidebar isn't shown. */
  reviewing: boolean;
  setWidth(width: number): void;
  setState(state: SidebarState): void;
  setViewport(viewport: number): void;
  setReviewing(on: boolean): void;
  /** ⌘B and the header's toggle: open or close. */
  toggle(): void;
}

export const useSidebar = create<SidebarStore>()((set, get) => ({
  ...load(),
  viewport: window.innerWidth,
  reviewing: false,
  setWidth: (width) => set({ width: clampSidebarWidth(width) }),
  setState: (state) => set({ state: state === 'open' ? 'open' : 'closed' }),
  setViewport: (viewport) => set({ viewport }),
  setReviewing: (reviewing) => set({ reviewing }),
  toggle: () => {
    const s = get();
    // Shown closed only because the window is too small: there is no room to open it.
    if (shownSidebar(s).state !== s.state) return;
    set({ state: s.state === 'open' ? 'closed' : 'open' });
  },
}));

useSidebar.subscribe((s) => {
  try {
    localStorage.setItem(KEY, JSON.stringify({ width: s.width, state: s.state }));
  } catch {
    // A full or blocked storage only loses the remembered layout.
  }
});

/** What shows: closed during a review or in a window too narrow for it, else the saved state and width. */
export function shownSidebar(s: Pick<SidebarStore, 'state' | 'width' | 'viewport' | 'reviewing'>): SidebarSnap {
  if (s.reviewing) return { state: 'closed', width: 0 };
  const fit = fitSidebar(s.state, s.width, s.viewport);
  return fit.state === 'minimal' ? { state: 'closed', width: 0 } : fit;
}

export function useShownSidebar(): SidebarSnap {
  const state = useSidebar((s) => s.state);
  const width = useSidebar((s) => s.width);
  const viewport = useSidebar((s) => s.viewport);
  const reviewing = useSidebar((s) => s.reviewing);
  return shownSidebar({ state, width, viewport, reviewing });
}
