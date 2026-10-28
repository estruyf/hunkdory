import { contextBridge, ipcRenderer } from 'electron';
import type { ReviewerApi, ReviewState, WalkthroughJob } from '../shared/types.ts';

const methods: (keyof ReviewerApi)[] = [
  'listProjects',
  'checkFolder',
  'chooseFolder',
  'foundOnThisMac',
  'addProject',
  'updateProject',
  'removeProject',
  'setWriteWalkthroughs',
  'checkGitHub',
  'listBranches',
  'trackBranch',
  'openExternal',
  'inbox',
  'loadReview',
  'updateReview',
  'finish',
  'openSessionFile',
  'walkthroughJob',
  'writeWalkthrough',
  'cancelWalkthrough',
  'ask',
  'cancelExchange',
  'fileLines',
  'searchCode',
  'shareWalkthrough',
];

const api = Object.fromEntries(methods.map((m) => [m, (...args: unknown[]) => ipcRenderer.invoke(`api:${m}`, ...args)])) as unknown as ReviewerApi;

contextBridge.exposeInMainWorld('api', api);
contextBridge.exposeInMainWorld('events', {
  onReviewsChanged(fn: () => void) {
    const listener = () => fn();
    ipcRenderer.on('reviews-changed', listener);
    return () => ipcRenderer.removeListener('reviews-changed', listener);
  },
  onReviewStateChanged(fn: (review: ReviewState) => void) {
    const listener = (_e: unknown, review: ReviewState) => fn(review);
    ipcRenderer.on('review-state-changed', listener);
    return () => ipcRenderer.removeListener('review-state-changed', listener);
  },
  onNavigate(fn: (dir: 'back' | 'forward') => void) {
    const listener = (_e: unknown, dir: 'back' | 'forward') => fn(dir);
    ipcRenderer.on('navigate', listener);
    return () => ipcRenderer.removeListener('navigate', listener);
  },
  onWalkthroughChanged(fn: (job: WalkthroughJob) => void) {
    const listener = (_e: unknown, job: WalkthroughJob) => fn(job);
    ipcRenderer.on('walkthrough-changed', listener);
    return () => ipcRenderer.removeListener('walkthrough-changed', listener);
  },
});
