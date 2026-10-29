import { useEffect, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { SIDEBAR_DEFAULT_WIDTH, SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_WIDTH, SNAP_CLOSED, clampSidebarWidth, type SidebarSnap } from '../../lib/sidebarWidth.ts';
import { useShownSidebar, useSidebar } from '../../state/sidebar.ts';
import { Sidebar } from './Sidebar.tsx';
import { useSidebarData } from './useSidebarData.ts';

/** Where a drag of the edge lands: closed when dragged narrow, otherwise open at that width. */
const dragTo = (x: number): SidebarSnap => (x < SNAP_CLOSED ? { state: 'closed', width: 0 } : { state: 'open', width: clampSidebarWidth(Math.max(x, SIDEBAR_MIN_WIDTH)) });

/**
 * The sidebar's right edge (the window's left edge while it is closed), as in Switchboard: drag to resize,
 * drag it narrow to close or out from the edge to open, ← and → step the width, a double-click resets it.
 */
function ResizeHandle({ fitted, onDragging }: { fitted: SidebarSnap; onDragging(dragging: boolean): void }) {
  const { state, width: shown } = fitted;
  const apply = (next: SidebarSnap) => {
    const store = useSidebar.getState();
    if (next.state === 'open') store.setWidth(next.width);
    store.setState(next.state);
  };
  const startResize = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const startX = event.clientX;
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    onDragging(true);
    const move = (e: globalThis.PointerEvent) => apply(dragTo(shown + (e.clientX - startX)));
    const up = () => {
      onDragging(false);
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const store = useSidebar.getState();
    if (store.state !== 'open') return event.key === 'ArrowRight' && store.setState('open');
    const next = store.width + (event.key === 'ArrowLeft' ? -16 : 16);
    apply(next < SIDEBAR_MIN_WIDTH ? { state: 'closed', width: 0 } : { state: 'open', width: next });
  };
  return (
    <div
      onPointerDown={startResize}
      onKeyDown={onKeyDown}
      onDoubleClick={() => apply({ state: 'open', width: SIDEBAR_DEFAULT_WIDTH })}
      tabIndex={0}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      aria-valuenow={shown}
      aria-valuemin={0}
      aria-valuemax={SIDEBAR_MAX_WIDTH}
      aria-valuetext={state === 'open' ? `${shown} pixels` : 'Closed'}
      data-tooltip={state === 'closed' ? 'Drag to show the sidebar' : 'Drag to resize, double-click to reset'}
      className={`no-drag absolute inset-y-0 z-20 w-1.5 cursor-col-resize outline-none hover:bg-accent/40 focus-visible:bg-accent-ink/60 ${state === 'closed' ? 'left-0' : '-right-[3px]'}`}
    />
  );
}

/**
 * The sidebar: open with the branches to review, or closed. During a review it isn't there at all: you
 * finish the review, or go back to the inbox, before you pick another branch.
 */
export function SidebarShell() {
  const data = useSidebarData();
  const fitted = useShownSidebar();
  const reviewing = useSidebar((s) => s.reviewing);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const onResize = () => useSidebar.getState().setViewport(window.innerWidth);
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return (
    <div className={`relative h-full shrink-0 ${dragging ? '' : 'transition-[width] duration-150 ease-out motion-reduce:transition-none'}`} style={{ width: fitted.width }}>
      <div className="h-full overflow-hidden">{fitted.state === 'open' && <Sidebar data={data} />}</div>
      {!reviewing && <ResizeHandle fitted={fitted} onDragging={setDragging} />}
    </div>
  );
}
