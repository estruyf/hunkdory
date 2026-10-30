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
  'ignoreBranch',
  'listBases',
  'setBase',
  'openExternal',
  'inbox',
  'loadReview',
  'updateReview',
  'finish',
  'openSessionFile',
  'walkthroughJob',
  'walkthroughJobs',
  'writeWalkthrough',
  'cancelWalkthrough',
  'ask',
  'cancelExchange',
  'fileLines',
  'searchCode',
  'shareWalkthrough',
  'settings',
  'setTheme',
  'appInfo',
];

const api = Object.fromEntries(methods.map((m) => [m, (...args: unknown[]) => ipcRenderer.invoke(`api:${m}`, ...args)])) as unknown as ReviewerApi;

contextBridge.exposeInMainWorld('api', api);
contextBridge.exposeInMainWorld('frame', {
  platform: process.platform,
  onFullScreen(fn: (on: boolean) => void) {
    const listener = (_e: unknown, on: boolean) => fn(on);
    ipcRenderer.on('full-screen', listener);
    return () => ipcRenderer.removeListener('full-screen', listener);
  },
});
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
  onOpenBranch(fn: (to: { projectId: string; branch: string }) => void) {
    const listener = (_e: unknown, to: { projectId: string; branch: string }) => fn(to);
    ipcRenderer.on('open-branch', listener);
    return () => ipcRenderer.removeListener('open-branch', listener);
  },
  onWalkthroughChanged(fn: (job: WalkthroughJob) => void) {
    const listener = (_e: unknown, job: WalkthroughJob) => fn(job);
    ipcRenderer.on('walkthrough-changed', listener);
    return () => ipcRenderer.removeListener('walkthrough-changed', listener);
  },
});
