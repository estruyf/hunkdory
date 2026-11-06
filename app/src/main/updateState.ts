import type { UpdateCommand, UpdateState } from '../shared/update.ts';

/**
 * The updater's state machine. Every change is a pure function from one state to the next, so the flow
 * (checking → available → downloading → downloaded → installing, failures and retry) is tested without Electron;
 * `updater.ts` only calls these.
 */

export function initialUpdateState(options: { currentVersion: string; disabledReason: string | null; updatedTo?: string | null }): UpdateState {
  return {
    status: options.disabledReason ? 'disabled' : 'idle',
    currentVersion: options.currentVersion,
    availableVersion: null,
    downloadedVersion: null,
    downloadPercent: null,
    releaseNotes: null,
    error: null,
    canRetry: false,
    disabledReason: options.disabledReason,
    updatedTo: options.updatedTo ?? null,
  };
}

/** Busy: a second check, download or install must wait. */
export const isBusy = (state: UpdateState) => state.status === 'checking' || state.status === 'downloading' || state.status === 'installing';

export function checking(state: UpdateState): UpdateState {
  if (state.status === 'disabled' || isBusy(state)) return state;
  return { ...state, status: 'checking', error: null, canRetry: false };
}

/** No newer version. A downloaded update stays ready to install. */
export function upToDate(state: UpdateState): UpdateState {
  if (state.status === 'disabled') return state;
  if (state.downloadedVersion) return { ...state, status: 'downloaded' };
  return { ...state, status: 'up-to-date', availableVersion: null, releaseNotes: null };
}

/** A check found `version`. The version already downloaded isn't news. */
export function available(state: UpdateState, update: { version: string; releaseNotes: string | null }): UpdateState {
  if (state.status === 'disabled') return state;
  if (update.version === state.downloadedVersion) return { ...state, status: 'downloaded' };
  return { ...state, status: 'available', availableVersion: update.version, downloadedVersion: null, downloadPercent: null, releaseNotes: update.releaseNotes };
}

export function downloading(state: UpdateState, percent: number): UpdateState {
  if (!state.availableVersion || (state.status !== 'available' && state.status !== 'downloading' && state.status !== 'error')) return state;
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));
  return { ...state, status: 'downloading', downloadPercent: clamped, error: null, canRetry: false };
}

export function downloaded(state: UpdateState, version: string): UpdateState {
  if (state.status === 'disabled') return state;
  return { ...state, status: 'downloaded', downloadedVersion: version, availableVersion: version, downloadPercent: 100, error: null, canRetry: false };
}

export function installing(state: UpdateState): UpdateState {
  if (state.status !== 'downloaded' && !(state.status === 'error' && state.downloadedVersion)) return state;
  return { ...state, status: 'installing', error: null, canRetry: false };
}

/** A download or install failed. What was known (the available or downloaded version) is kept for Retry. */
export function failed(state: UpdateState, message: string, canRetry: boolean): UpdateState {
  if (state.status === 'disabled') return state;
  return { ...state, status: 'error', error: message, canRetry, downloadPercent: null };
}

/**
 * A check failed, which is usually being offline for a moment. An update it found earlier is still there, so that is
 * still what's on offer: being offline must not turn it into "The update failed".
 */
export function checkFailed(state: UpdateState, message: string, canRetry: boolean): UpdateState {
  if (state.downloadedVersion) return { ...state, status: 'downloaded' };
  if (state.availableVersion) return { ...state, status: 'available' };
  return failed(state, message, canRetry);
}

export function dismissUpdated(state: UpdateState): UpdateState {
  return state.updatedTo ? { ...state, updatedTo: null } : state;
}

/** What Retry should do from here: install a downloaded update, download a found one, or check again. */
export function nextCommand(state: UpdateState): Exclude<UpdateCommand, 'retry' | 'dismiss'> | null {
  if (state.status === 'disabled' || isBusy(state)) return null;
  if (state.downloadedVersion) return 'install';
  if (state.availableVersion) return 'download';
  return 'check';
}

/** Why this build can't update itself, or null when it can. */
export function updatesDisabledReason(build: { packaged: boolean; hasFeed: boolean; mockFeed: boolean }): string | null {
  if (build.mockFeed) return null;
  if (!build.packaged) return 'Updates are turned off in development builds.';
  if (!build.hasFeed) return 'This build has no update feed, so it can’t update itself.';
  return null;
}
