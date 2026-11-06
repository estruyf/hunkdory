import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanReleaseNotes } from '../src/main/releaseNotes.ts';
import { available, checkFailed, checking, downloaded, failed, initialUpdateState, nextCommand, updatesDisabledReason } from '../src/main/updateState.ts';
import { readUpdateMarker, Updater, type AutoUpdater, type UpdaterOptions } from '../src/main/updater.ts';
import { updateStatusText, updateToast, type UpdateState } from '../src/shared/update.ts';

const idle = initialUpdateState({ currentVersion: '0.1.0', disabledReason: null });
const offered = available(idle, { version: '0.2.0', releaseNotes: 'Notes' });
const ready = downloaded(offered, '0.2.0');
const marker = () => join(mkdtempSync(join(tmpdir(), 'hunkdory-update-')), 'update-marker.json');

function fakeUpdater(offer: { version: string; releaseNotes?: unknown } | Error) {
  const progress: ((p: { percent: number }) => void)[] = [];
  const fake = {
    autoDownload: true,
    autoInstallOnAppQuit: false,
    allowPrerelease: true,
    allowDowngrade: true,
    forceDevUpdateConfig: false,
    logger: null as unknown,
    feed: null as unknown,
    installed: 0,
    checks: 0,
    offer,
    failDownload: false,
    failInstall: false,
    setFeedURL(options: unknown) {
      this.feed = options;
    },
    async checkForUpdates() {
      this.checks++;
      if (this.offer instanceof Error) throw this.offer;
      return { updateInfo: this.offer, isUpdateAvailable: this.offer.version !== '0.1.0' };
    },
    async downloadUpdate() {
      if (this.failDownload) throw new Error('Cannot update while running on a read-only volume.');
      progress.forEach((l) => l({ percent: 50 }));
      return [];
    },
    quitAndInstall() {
      if (this.failInstall) throw new Error('Squirrel said no.');
      this.installed++;
    },
    on(_event: 'download-progress', listener: (p: { percent: number }) => void) {
      progress.push(listener);
    },
  };
  return fake;
}

function setup(fake: ReturnType<typeof fakeUpdater>, extra: Partial<UpdaterOptions> = {}) {
  const states: UpdateState[] = [];
  const calls = { before: 0, failed: 0 };
  const updater = new Updater({
    currentVersion: '0.1.0',
    disabledReason: null,
    markerFile: marker(),
    onState: (s) => states.push(s),
    beforeInstall: () => void calls.before++,
    installFailed: () => void calls.failed++,
    log: () => {},
    load: async () => fake as unknown as AutoUpdater,
    ...extra,
  });
  return { updater, states, calls };
}

test('a newer release goes from offered, through downloading, to a restart', async () => {
  const fake = fakeUpdater({ version: '0.2.0', releaseNotes: '<p>New <b>things</b></p>' });
  const { updater, states, calls } = setup(fake);
  await updater.check();
  assert.equal(updater.state.status, 'available');
  assert.equal(updater.state.availableVersion, '0.2.0');
  assert.equal(updater.state.releaseNotes, 'New things');
  await updater.download();
  assert.equal(updater.state.status, 'downloaded');
  assert.ok(states.some((s) => s.status === 'downloading' && s.downloadPercent === 50));
  await updater.install();
  assert.equal(updater.state.status, 'installing');
  assert.equal(fake.installed, 1);
  // Before quitAndInstall: Electron closes the windows ahead of before-quit, and closing one otherwise only hides it.
  assert.equal(calls.before, 1);
  updater.stop();
});

test('the updater only looks at releases, downloads when asked, and never goes back', async () => {
  const fake = fakeUpdater({ version: '0.2.0' });
  const { updater } = setup(fake);
  await updater.check();
  assert.equal(fake.autoDownload, false);
  assert.equal(fake.autoInstallOnAppQuit, true);
  assert.equal(fake.allowPrerelease, false);
  assert.equal(fake.allowDowngrade, false);
  assert.equal(fake.feed, null);
  updater.stop();
});

test('the mock feed replaces GitHub', async () => {
  const fake = fakeUpdater({ version: '0.2.0' });
  const { updater } = setup(fake, { mockFeedUrl: 'http://localhost:8484' });
  await updater.check();
  assert.deepEqual(fake.feed, { provider: 'generic', url: 'http://localhost:8484' });
  assert.equal(fake.forceDevUpdateConfig, true);
  updater.stop();
});

test('the same version is up to date', async () => {
  const { updater } = setup(fakeUpdater({ version: '0.1.0' }));
  await updater.check();
  assert.equal(updater.state.status, 'up-to-date');
  assert.equal(updateToast(updater.state), null);
  updater.stop();
});

test('a failed check while offline keeps what was on offer, without a toast about failing', async () => {
  const fake = fakeUpdater({ version: '0.2.0' });
  const { updater } = setup(fake);
  await updater.check();
  fake.offer = new Error('net::ERR_INTERNET_DISCONNECTED');
  await updater.check();
  assert.equal(updater.state.status, 'available');
  assert.equal(updateToast(updater.state)?.key, 'available:0.2.0');
  updater.stop();
});

test('a failed first check stays in Settings', async () => {
  const { updater } = setup(fakeUpdater(new Error('net::ERR_INTERNET_DISCONNECTED')));
  await updater.check();
  assert.equal(updater.state.status, 'error');
  assert.equal(updateToast(updater.state), null);
  assert.match(updateStatusText(updater.state), /^Couldn’t check for updates: /);
  updater.stop();
});

test('a failed download shows, and Retry downloads again', async () => {
  const fake = fakeUpdater({ version: '0.2.0' });
  const { updater } = setup(fake);
  await updater.check();
  fake.failDownload = true;
  await updater.download();
  assert.equal(updater.state.status, 'error');
  assert.deepEqual(updateToast(updater.state)?.action, { label: 'Retry', run: 'retry' });
  assert.equal(nextCommand(updater.state), 'download');
  fake.failDownload = false;
  updater.run('retry');
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  assert.equal(updater.state.status, 'downloaded');
  updater.stop();
});

test('an install that fails leaves the app running, without a marker', async () => {
  const fake = fakeUpdater({ version: '0.2.0' });
  fake.failInstall = true;
  const markerFile = marker();
  const { updater, calls } = setup(fake, { markerFile });
  await updater.check();
  await updater.download();
  await updater.install();
  assert.equal(updater.state.status, 'error');
  assert.equal(calls.failed, 1);
  assert.equal(existsSync(markerFile), false);
  assert.equal(nextCommand(updater.state), 'install');
  updater.stop();
});

test('a build that can’t update never loads the updater', async () => {
  const { updater } = setup(fakeUpdater({ version: '0.2.0' }), {
    disabledReason: 'Updates are turned off in development builds.',
    load: async () => {
      throw new Error('should not load');
    },
  });
  await updater.check();
  assert.equal(updater.state.status, 'disabled');
  assert.equal(updateStatusText(updater.state), 'Updates are turned off in development builds.');
  updater.stop();
});

test('builds without a feed can’t update, unless a mock feed is set', () => {
  assert.equal(updatesDisabledReason({ packaged: true, hasFeed: true, mockFeed: false }), null);
  assert.match(updatesDisabledReason({ packaged: false, hasFeed: false, mockFeed: false })!, /development/);
  assert.match(updatesDisabledReason({ packaged: true, hasFeed: false, mockFeed: false })!, /no update feed/);
  assert.equal(updatesDisabledReason({ packaged: false, hasFeed: false, mockFeed: true }), null);
});

test('the marker says what the last install did, once', () => {
  const file = marker();
  const write = (version: string, at: number) => writeFileSync(file, JSON.stringify({ version, at }));
  assert.deepEqual(readUpdateMarker(file, '0.2.0'), { updatedTo: null, error: null });
  write('0.2.0', 1000);
  assert.deepEqual(readUpdateMarker(file, '0.2.0', 2000), { updatedTo: '0.2.0', error: null });
  assert.equal(existsSync(file), false);
  write('0.2.0', 1000);
  assert.match(readUpdateMarker(file, '0.1.0', 2000).error!, /didn’t install/);
  write('0.2.0', 1000);
  assert.deepEqual(readUpdateMarker(file, '0.2.0', 1000 + 60 * 60_000), { updatedTo: null, error: null });
});

test('the toast follows the steps, and a new step shows again after hiding the last one', () => {
  assert.equal(updateToast(null), null);
  assert.equal(updateToast(idle), null);
  assert.deepEqual(updateToast(offered)?.action, { label: 'Download', run: 'download' });
  assert.equal(updateToast(offered)?.notes, 'Notes');
  assert.deepEqual(updateToast(ready)?.action, { label: 'Restart to update', run: 'install' });
  assert.notEqual(updateToast(offered)?.key, updateToast(ready)?.key);
  const updated = initialUpdateState({ currentVersion: '0.2.0', disabledReason: null, updatedTo: '0.2.0' });
  assert.equal(updateToast(updated)?.title, 'Updated to Hunkdory 0.2.0');
  assert.equal(updateToast(updated)?.close, 'dismiss');
});

test('a later check doesn’t take the offer off the screen while it runs', () => {
  assert.equal(updateToast(checking(offered))?.key, 'available:0.2.0');
  assert.equal(updateToast(checking(ready))?.key, 'downloaded:0.2.0');
  assert.equal(updateToast(checking(idle)), null);
});

test('a failed check keeps a finished download ready', () => {
  assert.equal(checkFailed(checking(ready), 'offline', true).status, 'downloaded');
  assert.equal(checkFailed(checking(idle), 'offline', true).status, 'error');
  assert.equal(failed(offered, 'nope', true).availableVersion, '0.2.0');
});

test('release notes turn into short plain text, and bad ones into nothing', () => {
  assert.equal(cleanReleaseNotes('<h2>Changes</h2><ul><li>One &amp; two</li></ul>'), 'Changes\n\n- One & two');
  assert.equal(cleanReleaseNotes('## Changes\n* **Bold** [link](https://x.dev)'), 'Changes\n- Bold link');
  assert.equal(cleanReleaseNotes([{ version: '1.0.0', note: 'First' }]), '1.0.0\n\nFirst');
  assert.equal(cleanReleaseNotes(null), null);
  assert.equal(cleanReleaseNotes('   '), null);
  const cut = cleanReleaseNotes('x'.repeat(50), 10)!;
  assert.equal(cut, `${'x'.repeat(10)}\n…`);
});
