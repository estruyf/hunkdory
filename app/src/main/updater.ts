import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import type { UpdateCommand, UpdateState } from '../shared/update.ts';
import { cleanReleaseNotes } from './releaseNotes.ts';
import { available, checkFailed, checking, dismissUpdated, downloaded, downloading, failed, initialUpdateState, installing, isBusy, nextCommand, upToDate } from './updateState.ts';

/** The first automatic check waits this long after launch, so it never slows startup. */
export const FIRST_CHECK_DELAY_MS = 15_000;
export const CHECK_INTERVAL_MS = 4 * 60 * 60_000;
/** Generous limits, so a hung updater ends as a visible error instead of a toast that spins forever. */
const CHECK_TIMEOUT_MS = 60_000;
const DOWNLOAD_STALL_MS = 120_000;
const INSTALL_TIMEOUT_MS = 30_000;
/** "Updated to X" is only shown for a marker this fresh. */
const MARKER_MAX_AGE_MS = 15 * 60_000;

/** The part of electron-updater's AppUpdater this uses. */
export interface AutoUpdater {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  allowPrerelease: boolean;
  allowDowngrade: boolean;
  forceDevUpdateConfig: boolean;
  logger: unknown;
  setFeedURL(options: { provider: 'generic'; url: string }): void;
  checkForUpdates(): Promise<{ updateInfo: { version: string; releaseNotes?: unknown }; isUpdateAvailable?: boolean } | null>;
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
  on(event: 'download-progress', listener: (progress: { percent: number }) => void): unknown;
}

export interface UpdaterOptions {
  currentVersion: string;
  /** Set when this build can't update; nothing is loaded or checked then. */
  disabledReason: string | null;
  /** Written before restarting into an update, read after it. */
  markerFile: string;
  /** HUNKDORY_MOCK_UPDATES_URL: a local feed instead of GitHub. */
  mockFeedUrl?: string;
  onState(state: UpdateState): void;
  /** Called right before quitAndInstall: the app is quitting, so closing the window must not just hide it. */
  beforeInstall(): void;
  /** The install failed or the app wasn't restarted (e.g. run from the DMG): undo beforeInstall, the app keeps running. */
  installFailed(): void;
  log(message: string): void;
  /** Injected in tests; defaults to electron-updater's autoUpdater (loaded on first use). */
  load?: () => Promise<AutoUpdater>;
}

/** What the marker file from the last install says about this launch. */
export function readUpdateMarker(file: string, currentVersion: string, now = Date.now()): { updatedTo: string | null; error: string | null } {
  let marker: { version?: unknown; at?: unknown };
  try {
    marker = JSON.parse(readFileSync(file, 'utf8')) as typeof marker;
  } catch {
    return { updatedTo: null, error: null };
  }
  try {
    rmSync(file, { force: true });
  } catch {
    // Read once is enough; a leftover marker is ignored once it's old.
  }
  if (typeof marker.version !== 'string' || typeof marker.at !== 'number' || now - marker.at > MARKER_MAX_AGE_MS) return { updatedTo: null, error: null };
  return marker.version === currentVersion ? { updatedTo: currentVersion, error: null } : { updatedTo: null, error: `The update to ${marker.version} didn’t install. Download it again to retry.` };
}

const withTimeout = <T,>(promise: Promise<T>, ms: number, message: string): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => (clearTimeout(timer), resolve(value)),
      (error: unknown) => (clearTimeout(timer), reject(error)),
    );
  });

/** Network trouble is worth retrying; a bad feed or signature would just fail again. */
function retryable(error: Error): boolean {
  const code = (error as Error & { code?: string }).code ?? '';
  if (/ERR_UPDATER_(INVALID|CHANNEL_FILE_NOT_FOUND|NO_PUBLISHED)/.test(code)) return false;
  return !/code signature|signature|not signed|Could not get code signature/i.test(error.message);
}

/** First line, without the stack or the XML electron-updater appends to some errors. */
const shortMessage = (error: Error) => (error.message.split('\n')[0] ?? 'Unknown error').slice(0, 300);

/**
 * Checks GitHub (or the mock feed) for a newer release, downloads it when you ask, and restarts into it when you ask.
 * Only releases count: a pre-release is never offered.
 */
export class Updater {
  #options: UpdaterOptions;
  #state: UpdateState;
  #updater: Promise<AutoUpdater> | undefined;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #stallTimer: ReturnType<typeof setTimeout> | undefined;
  #installTimer: ReturnType<typeof setTimeout> | undefined;
  #onProgress: (() => void) | undefined;

  constructor(options: UpdaterOptions) {
    this.#options = options;
    const marker = options.disabledReason ? { updatedTo: null, error: null } : readUpdateMarker(options.markerFile, options.currentVersion);
    const state = initialUpdateState({ currentVersion: options.currentVersion, disabledReason: options.disabledReason, updatedTo: marker.updatedTo });
    this.#state = marker.error ? failed(state, marker.error, true) : state;
  }

  get state(): UpdateState {
    return this.#state;
  }

  /** Schedules the automatic checks. */
  start(): void {
    this.#schedule(FIRST_CHECK_DELAY_MS);
  }

  stop(): void {
    clearTimeout(this.#timer);
    clearTimeout(this.#stallTimer);
    // Quitting (also the quit quitAndInstall starts): not a failed install.
    clearTimeout(this.#installTimer);
  }

  run(command: UpdateCommand): void {
    if (command === 'dismiss') return this.#set(dismissUpdated(this.#state));
    const next = command === 'retry' ? nextCommand(this.#state) : command;
    if (next === 'check') void this.check();
    else if (next === 'download') void this.download();
    else if (next === 'install') void this.install();
  }

  async check(): Promise<void> {
    if (this.#state.status === 'disabled') return;
    if (isBusy(this.#state)) {
      // The automatic check came while a download ran: keep the schedule going instead of stopping it.
      this.#schedule(CHECK_INTERVAL_MS);
      return;
    }
    this.#set(checking(this.#state));
    try {
      const updater = await this.#load();
      const result = await withTimeout(updater.checkForUpdates(), CHECK_TIMEOUT_MS, 'Checking for updates took too long.');
      const info = result?.updateInfo;
      if (!info || result.isUpdateAvailable === false || info.version === this.#options.currentVersion) this.#set(upToDate(this.#state));
      else this.#set(available(this.#state, { version: info.version, releaseNotes: cleanReleaseNotes(info.releaseNotes) }));
    } catch (error) {
      this.#options.log(`Update check failed: ${(error as Error).message}`);
      this.#set(checkFailed(this.#state, shortMessage(error as Error), retryable(error as Error)));
    } finally {
      this.#schedule(CHECK_INTERVAL_MS);
    }
  }

  async download(): Promise<void> {
    const version = this.#state.availableVersion;
    if (!version || this.#state.downloadedVersion || isBusy(this.#state)) return;
    this.#set(downloading(this.#state, 0));
    try {
      const updater = await this.#load();
      await new Promise<void>((resolve, reject) => {
        // A download that stops making progress fails instead of hanging.
        const stalled = () => reject(new Error('The download stopped making progress.'));
        this.#stallTimer = setTimeout(stalled, DOWNLOAD_STALL_MS);
        this.#onProgress = () => {
          clearTimeout(this.#stallTimer);
          this.#stallTimer = setTimeout(stalled, DOWNLOAD_STALL_MS);
        };
        updater.downloadUpdate().then(() => resolve(), reject);
      });
      this.#set(downloaded(this.#state, version));
    } catch (error) {
      this.#options.log(`Update download failed: ${(error as Error).message}`);
      this.#set(failed(this.#state, shortMessage(error as Error), retryable(error as Error)));
    } finally {
      clearTimeout(this.#stallTimer);
      this.#onProgress = undefined;
    }
  }

  /** Restarts into the downloaded update. */
  async install(): Promise<void> {
    const version = this.#state.downloadedVersion;
    if (!version) return;
    const next = installing(this.#state);
    if (next === this.#state) return;
    this.#set(next);
    try {
      const updater = await this.#load();
      writeFileSync(this.#options.markerFile, JSON.stringify({ version, from: this.#options.currentVersion, at: Date.now() }));
      this.#options.beforeInstall();
      updater.quitAndInstall(false, true);
      // Still here after a while: Squirrel didn't restart us.
      clearTimeout(this.#installTimer);
      this.#installTimer = setTimeout(() => {
        if (this.#state.status === 'installing') this.#installFailed('Hunkdory didn’t restart to install the update.');
      }, INSTALL_TIMEOUT_MS);
      this.#installTimer.unref?.();
    } catch (error) {
      this.#installFailed(shortMessage(error as Error));
    }
  }

  /** The app keeps running on this version: no marker, closing the window hides it again, and Retry offered. */
  #installFailed(message: string): void {
    try {
      rmSync(this.#options.markerFile, { force: true });
    } catch {
      // A leftover marker is ignored once it's old.
    }
    this.#options.installFailed();
    this.#set(failed(this.#state, message, true));
  }

  #set(state: UpdateState): void {
    if (state === this.#state) return;
    this.#state = state;
    this.#options.onState(state);
  }

  #schedule(delay: number): void {
    clearTimeout(this.#timer);
    if (this.#state.status === 'disabled') return;
    this.#timer = setTimeout(() => void this.check(), delay);
    this.#timer.unref?.();
  }

  #load(): Promise<AutoUpdater> {
    this.#updater ??= (this.#options.load ?? loadAutoUpdater)().then(
      (updater) => {
        updater.autoDownload = false;
        updater.autoInstallOnAppQuit = true;
        // Pre-releases stay off the feed, also for a build that is one itself, and a newer build never goes back.
        updater.allowPrerelease = false;
        updater.allowDowngrade = false;
        updater.logger = { info: () => {}, warn: (m: unknown) => this.#options.log(String(m)), error: (m: unknown) => this.#options.log(String(m)), debug: () => {} };
        if (this.#options.mockFeedUrl) {
          updater.forceDevUpdateConfig = true;
          updater.setFeedURL({ provider: 'generic', url: this.#options.mockFeedUrl });
        }
        updater.on('download-progress', (progress) => {
          this.#onProgress?.();
          this.#set(downloading(this.#state, progress.percent));
        });
        return updater;
      },
      (error: unknown) => {
        // Try loading again on the next check rather than failing every check from now on.
        this.#updater = undefined;
        throw error;
      },
    );
    return this.#updater;
  }
}

async function loadAutoUpdater(): Promise<AutoUpdater> {
  // electron-updater is CommonJS and costs startup time, so it's only loaded for the first check.
  const module = (await import('electron-updater')) as unknown as { autoUpdater?: AutoUpdater; default?: { autoUpdater: AutoUpdater } };
  const updater = module.autoUpdater ?? module.default?.autoUpdater;
  if (!updater) throw new Error('electron-updater did not load');
  return updater;
}
