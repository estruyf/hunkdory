// What a screen needs to know about the tab it's in. A tab in the background stays mounted, so your place, your
// half-written comment and Claude's answers stay with it, but it's out of sight: it must leave the keys alone.
import { createContext, useContext, useEffect, useRef } from 'react';

const TabPaneContext = createContext(true);
export const TabPane = TabPaneContext.Provider;

/** Whether this screen's tab is the one on screen. A listener on `window` should only listen while it is. */
export const useTabActive = () => useContext(TabPaneContext);

/** How long a tab has to be away before coming back reads its branch again: the same as the inbox on window focus. */
const AWAY_MS = 30_000;

/** Runs when the tab comes back on screen after a while, as the branch may have moved on since. */
export function useOnReturn(fn: () => void) {
  const active = useTabActive();
  const left = useRef<number | null>(null);
  const latest = useRef(fn);
  latest.current = fn;
  useEffect(() => {
    if (!active) {
      left.current = Date.now();
      return;
    }
    if (left.current !== null && Date.now() - left.current >= AWAY_MS) latest.current();
    left.current = null;
  }, [active]);
}
