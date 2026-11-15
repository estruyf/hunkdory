// hunkdory:// links from other apps and websites. Main works out where one goes; this opens that screen, or says
// why it can't. A link only ever opens a screen, so a branch it opened doesn't start a walkthrough by itself.
import { create } from 'zustand';
import type { LinkTarget } from '../../shared/types.ts';
import type { Go } from '../App.tsx';
import { jobKey } from './walkthroughs.ts';

/** What the toast says about the last link: why it didn't open, or a folder that isn't a project yet. */
export const useLinkNotice = create<{ notice: Exclude<LinkTarget, { kind: 'review' }> | null }>()(() => ({ notice: null }));

/** Branches a link opened in this run: their plan waits for you to ask for a walkthrough. */
const opened = new Set<string>();

export const openedByLink = (projectId: string, branch: string) => opened.has(jobKey(projectId, branch));

/** Takes the link waiting in main, if there is one, and goes where it says. */
export async function takeLink(go: Go) {
  const target = await window.api.takeLink();
  if (!target) return;
  if (target.kind !== 'review') return useLinkNotice.setState({ notice: target });
  useLinkNotice.setState({ notice: null });
  opened.add(jobKey(target.projectId, target.branch));
  go({ name: 'plan', projectId: target.projectId, branch: target.branch });
}
