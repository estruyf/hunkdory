import { House, PanelLeft } from 'lucide-react';
import { currentPlatform } from '../../lib/platform.ts';
import { formatKeys, keysFor } from '../../lib/shortcuts.ts';
import { useBranches } from '../../state/branches.ts';
import { useNav } from '../../state/nav.ts';
import { useWalkthroughs } from '../../state/walkthroughs.ts';
import { useShownSidebar, useSidebar } from '../../state/sidebar.ts';
import { Button } from '../ui/Button.tsx';
import { Pill } from '../ui/Pill.tsx';
import { plural } from '../ui.tsx';

/**
 * The start of a view's header. Outside a review: the sidebar toggle (⌘B), as Switchboard's `SidebarToggle`,
 * and while the sidebar is closed a pill for what waits for your review. During a review there is no sidebar:
 * Inbox takes you back home, where you pick the next review. With the sidebar closed it makes room for the
 * traffic lights.
 */
export function SidebarToggle() {
  const shown = useShownSidebar().state;
  const reviewing = useSidebar((s) => s.reviewing);
  const go = useNav((s) => s.go);
  const lights = shown === 'closed' && currentPlatform() === 'darwin' ? 'ml-20' : '';
  if (reviewing)
    return (
      <div className={`flex shrink-0 items-center ${lights}`}>
        <Button variant="quiet" icon={<House size={14} aria-hidden />} shortcut="home" onClick={() => go({ name: 'home' })} data-tooltip={`Back to the inbox (${formatKeys(keysFor('home'))}). Your place in this review is kept.`}>
          Inbox
        </Button>
        <ReadyPill />
      </div>
    );
  const open = shown === 'open';
  return (
    <div className={`flex shrink-0 items-center gap-2 ${lights}`}>
      <Button
        variant="quiet"
        iconOnly
        icon={<PanelLeft size={15} aria-hidden />}
        aria-label={open ? 'Hide sidebar' : 'Show sidebar'}
        aria-expanded={open}
        data-tooltip={`Sidebar (${formatKeys(keysFor('sidebar.toggle'))})`}
        shortcut="sidebar.toggle"
        onClick={() => useSidebar.getState().toggle()}
      />
      {!open && <ToReviewPill />}
      {!open && <ReadyPill />}
    </div>
  );
}

/** Walkthroughs that finished for other branches while there was no sidebar to show it: opens the oldest. */
function ReadyPill() {
  const ready = Object.values(useWalkthroughs((s) => s.ready));
  const first = ready[0];
  if (!first) return null;
  return (
    <Pill
      tone="ok"
      onClick={() => useNav.getState().go({ name: 'plan', projectId: first.projectId, branch: first.branch })}
      data-tooltip={`Hunkdory finished the walkthrough for ${ready.map((r) => r.branch).join(', ')}. Open ${first.branch}.`}
    >
      {ready.length === 1 ? 'Walkthrough ready' : `${ready.length} walkthroughs ready`}
    </Pill>
  );
}

function ToReviewPill() {
  const count = useBranches((s) => s.toReview);
  const first = useBranches((s) => s.firstToReview);
  if (!count || !first) return null;
  return (
    <Pill onClick={() => useNav.getState().go({ name: 'plan', projectId: first.projectId, branch: first.branch })} aria-label={`${plural(count, 'branch', 'branches')} to review: open the first`} data-tooltip="Open the first branch to review" className="font-semibold">
      {count} to review
    </Pill>
  );
}
