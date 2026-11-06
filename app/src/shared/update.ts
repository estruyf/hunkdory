// The in-app updater's state, and what the toast and Settings say about it. Plain TypeScript, for main and the page.

export type UpdateStatus = 'disabled' | 'idle' | 'checking' | 'up-to-date' | 'available' | 'downloading' | 'downloaded' | 'installing' | 'error';

export type UpdateCommand = 'check' | 'download' | 'install' | 'retry' | 'dismiss';

export interface UpdateState {
  status: UpdateStatus;
  currentVersion: string;
  availableVersion: string | null;
  downloadedVersion: string | null;
  /** 0–100 while downloading. */
  downloadPercent: number | null;
  releaseNotes: string | null;
  error: string | null;
  canRetry: boolean;
  /** Why this build can't update itself. */
  disabledReason: string | null;
  /** This launch is the update you restarted for. */
  updatedTo: string | null;
}

export interface UpdateToast {
  /** Changes with the status and the version, so hiding one toast doesn't hide the next step ("Restart to update"). */
  key: string;
  title: string;
  body: string | null;
  tone: 'accent' | 'busy' | 'error' | 'ok';
  /** 0–100 while downloading. */
  progress: number | null;
  /** The yellow button, if there is something to do. */
  action: { label: string; run: UpdateCommand } | null;
  /** The release notes to offer under "What’s new". */
  notes: string | null;
  /** The close button tells main the news was seen (`dismiss`), or only hides the toast for now (`hide`). */
  close: 'dismiss' | 'hide';
}

/**
 * The update toast: only when there is something to act on or to know. A failed background check (offline, say) stays
 * in Settings; a failed download or install shows, since you started it.
 */
export function updateToast(state: UpdateState | null): UpdateToast | null {
  if (!state) return null;
  const toast = (key: string, title: string, rest: Partial<UpdateToast> = {}): UpdateToast => ({ key, title, body: null, tone: 'accent', progress: null, action: null, notes: null, close: 'hide', ...rest });
  // The check every few hours doesn't take away what it already found.
  const status = state.status === 'checking' ? (state.downloadedVersion ? 'downloaded' : state.availableVersion ? 'available' : 'checking') : state.status;
  switch (status) {
    case 'available':
      return toast(`available:${state.availableVersion}`, `Hunkdory ${state.availableVersion} is available`, {
        body: 'Download it now and restart when you’re ready.',
        action: { label: 'Download', run: 'download' },
        notes: state.releaseNotes,
      });
    case 'downloading':
      return toast(`downloading:${state.availableVersion}`, `Downloading Hunkdory ${state.availableVersion}…`, { tone: 'busy', progress: state.downloadPercent ?? 0 });
    case 'downloaded':
      return toast(`downloaded:${state.downloadedVersion}`, `Hunkdory ${state.downloadedVersion} is ready`, {
        body: 'Restart to install it, or it installs when you quit. Restarting stops any walkthrough or question still running.',
        action: { label: 'Restart to update', run: 'install' },
        notes: state.releaseNotes,
      });
    case 'installing':
      return toast('installing', 'Restarting to update…', { tone: 'busy' });
    case 'error': {
      const version = state.downloadedVersion ?? state.availableVersion;
      if (version) return toast(`error:${version}`, 'The update failed', { tone: 'error', body: state.error, action: state.canRetry ? { label: 'Retry', run: 'retry' } : null });
      break;
    }
  }
  if (state.updatedTo) return toast(`updated:${state.updatedTo}`, `Updated to Hunkdory ${state.updatedTo}`, { tone: 'ok', close: 'dismiss' });
  return null;
}

/** One line for Settings → About. */
export function updateStatusText(state: UpdateState): string {
  switch (state.status) {
    case 'disabled':
      return state.disabledReason ?? 'Updates are turned off.';
    case 'idle':
      return 'Hunkdory checks for updates on its own.';
    case 'checking':
      return 'Checking for updates…';
    case 'up-to-date':
      return 'Hunkdory is up to date.';
    case 'available':
      return `Version ${state.availableVersion} is available.`;
    case 'downloading':
      return `Downloading version ${state.availableVersion}… ${state.downloadPercent ?? 0}%`;
    case 'downloaded':
      return `Version ${state.downloadedVersion} is ready. Restart Hunkdory to install it.`;
    case 'installing':
      return 'Restarting to install the update…';
    case 'error':
      return `${state.availableVersion || state.downloadedVersion ? 'The update failed' : 'Couldn’t check for updates'}: ${state.error ?? 'unknown error'}`;
  }
}
