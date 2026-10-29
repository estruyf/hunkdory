import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, shell, Tray } from 'electron';
import { release } from 'node:os';
import { join, resolve } from 'node:path';
import { existsSync, renameSync } from 'node:fs';
import { Store } from './store.ts';
import { Projects } from './projects.ts';
import { Summaries } from './summaries.ts';
import { Actions } from './actions.ts';
import { GeneratedWalkthroughs, Writer } from './writer.ts';
import { Conversations } from './conversations.ts';
import { trayIcon } from './trayIcon.ts';
import { addToStepComment, removeFromStepComments } from '../shared/comments.ts';
import type { ReviewerApi, ReviewPatch, ReviewState, Theme } from '../shared/types.ts';

// The app icon. Packaged builds take icon.icns from resources/; this covers the dock and window in dev.
const ICON = join(__dirname, '../../resources/icon.png');

// The window's colour before the page draws: --bg in styles.css, light or dark.
const windowBackground = () => (nativeTheme.shouldUseDarkColors ? '#0f1115' : '#F6F7F9');

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;

// The app used to be called Reviewer, then briefly hunkdory: move the old data folder over once, so your
// projects and reviews stay. On a case-insensitive volume (the macOS default) "hunkdory" already is the
// current folder, so existsSync(current) skips the move.
if (!process.env.REVIEWER_USER_DATA) {
  const current = app.getPath('userData');
  const legacy = ['Reviewer', 'hunkdory'].map((n) => join(app.getPath('appData'), n)).find((p) => p !== current && existsSync(p));
  try {
    if (legacy && !existsSync(current)) renameSync(legacy, current);
  } catch (e) {
    console.error('Could not move the old data folder:', e);
  }
}
// Lets tests and demo runs use a throwaway store instead of your real reviews.
if (process.env.REVIEWER_USER_DATA) app.setPath('userData', process.env.REVIEWER_USER_DATA);
if (!app.requestSingleInstanceLock()) app.quit();

const store = new Store(join(app.getPath('userData'), 'store.json'));
const generated = new GeneratedWalkthroughs(join(app.getPath('userData'), 'walkthroughs'));
const projects = new Projects(store, generated, new Summaries(join(app.getPath('userData'), 'inbox-summaries.json')));
const logDir = join(app.getPath('userData'), 'agent-runs');
const writer = new Writer({
  projects,
  generated,
  logDir,
  onChange: (job) => {
    win?.webContents.send('walkthrough-changed', job);
    // The inbox shows whether a branch has a walkthrough.
    if (job.status === 'done') win?.webContents.send('reviews-changed');
  },
});
const wtvBin = resolve(app.getAppPath(), '../tools/wtv/bin/wtv.mjs');
const conversations = new Conversations({
  store,
  projects,
  logDir,
  wtvBin,
  onChange: (review) => win?.webContents.send('review-state-changed', review),
});
const actions = new Actions({
  store,
  projects,
  logDir,
  wtvBin,
  onChange: () => win?.webContents.send('reviews-changed'),
});

/** A send-back run that was going when the app quit: settle it if its process is gone. */
function settleStaleRuns() {
  for (const r of store.reviews()) {
    const pid = r.decision?.result === 'running' ? r.decision.pid : undefined;
    if (r.decision?.result !== 'running') continue;
    let alive = false;
    try {
      if (pid) alive = process.kill(pid, 0);
    } catch {}
    if (!alive) {
      store.updateReview(r.projectId, r.branch, (x) => {
        x.decision!.result = 'ok';
        x.decision!.message = 'The agent run finished while Hunkdory was closed.';
      });
    }
  }
}

function applyPatch(r: ReviewState, patch: ReviewPatch) {
  if (patch.type === 'start') {
    r.order = patch.order;
    r.startedAt ??= new Date().toISOString();
  } else if (patch.type === 'order') {
    r.order = patch.order;
  } else if (patch.type === 'reviewed') {
    if (patch.on) r.reviewed[patch.stepKey] = patch.hunkIds;
    else delete r.reviewed[patch.stepKey];
  } else if (patch.type === 'line-comment') {
    const body = patch.body.trim();
    const existing = patch.id ? r.comments.find((c) => c.id === patch.id) : null;
    if (existing && !body) r.comments = r.comments.filter((c) => c !== existing);
    else if (existing) existing.body = body;
    else if (body) {
      const { stepKey, hunkId, path, line, side } = patch;
      r.comments.push({ id: crypto.randomUUID(), stepKey, hunkId, line, path, side, body, createdAt: new Date().toISOString() });
    }
  } else if (patch.type === 'comment') {
    const body = patch.body.trim();
    // The step comment is the one without a line.
    const existing = r.comments.find((c) => c.stepKey === patch.stepKey && !c.line);
    if (!body) r.comments = r.comments.filter((c) => c !== existing);
    else if (existing) existing.body = body;
    else r.comments.push({ id: crypto.randomUUID(), stepKey: patch.stepKey, hunkId: null, line: null, body, createdAt: new Date().toISOString() });
  } else if (patch.type === 'settle') {
    r.settled ??= {};
    if (patch.value) r.settled[patch.id] = patch.value;
    else delete r.settled[patch.id];
    // Changing your mind takes the "needs a fix" line back out of the step's comment.
    if (patch.comment) {
      if (patch.value === 'fix' && patch.comment.stepKey) addToStepComment(r, patch.comment.stepKey, patch.comment.body);
      else removeFromStepComments(r, patch.comment.body);
    }
  } else if (patch.type === 'answer') {
    r.answers ??= {};
    const forStep = (r.answers[patch.stepKey] ??= {});
    if (patch.value) forStep[patch.index] = patch.value;
    else delete forStep[patch.index];
  }
}

const THEMES: Theme[] = ['system', 'light', 'dark'];

const api: ReviewerApi = {
  settings: async () => store.settings(),
  setTheme: async (theme) => {
    if (!THEMES.includes(theme)) throw new Error(`Unknown theme ${theme}`);
    // themeSource drives prefers-color-scheme in the page, so the CSS, scrollbars and form controls follow.
    nativeTheme.themeSource = theme;
    return store.updateSettings({ theme });
  },
  appInfo: async () => ({ version: app.getVersion(), electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node, os: `${process.platform === 'darwin' ? `macOS ${process.getSystemVersion()}` : `${process.platform} ${release()}`} (${process.arch})` }),
  listProjects: async () => store.projects(),
  checkFolder: (path) => projects.checkFolder(path),
  chooseFolder: async () => {
    const res = await dialog.showOpenDialog(win!, { properties: ['openDirectory'], message: 'Pick a folder with a git repository' });
    return res.canceled ? null : res.filePaths[0];
  },
  foundOnThisMac: async () => projects.foundOnThisMac(),
  addProject: (input) => projects.addProject(input),
  updateProject: (id, input) => projects.updateProject(id, input),
  removeProject: async (id) => store.removeProject(id),
  setWriteWalkthroughs: async (id, on) => projects.setWriteWalkthroughs(id, on),
  checkGitHub: (path) => projects.checkGitHub(path),
  listBranches: (projectId) => projects.listBranches(projectId),
  trackBranch: (projectId, branch) => projects.trackBranch(projectId, branch),
  ignoreBranch: async (projectId, branch, on) => projects.ignoreBranch(projectId, branch, on),
  openExternal: async (url) => {
    // Only links Hunkdory shows itself, like a pull request on GitHub.
    if (/^https:\/\//.test(url)) await shell.openExternal(url);
  },
  inbox: async (opts) => {
    const { items: waiting, scans, me } = await projects.inbox(opts?.refresh);
    const weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString();
    const done = store
      .reviews()
      .filter((r) => r.decision && r.decision.at >= weekAgo)
      .sort((a, b) => b.decision!.at.localeCompare(a.decision!.at));
    // Earlier rounds of a review that is open again still count as reviewed this week.
    for (const r of store.reviews()) {
      const last = r.rounds?.at(-1);
      if (!r.decision && last && last.decision.at >= weekAgo) {
        done.push({ ...r, decision: last.decision, status: last.decision.kind === 'merge' ? 'merged' : last.decision.kind === 'discard' ? 'discarded' : 'sent-back' });
      }
    }
    done.sort((a, b) => b.decision!.at.localeCompare(a.decision!.at));
    return { waiting, done, scans, me };
  },
  loadReview: async (projectId, branch, opts) => {
    const data = await projects.review(projectId, branch, opts?.refresh);
    const state = store.ensureReview(projectId, branch, { title: data.title, sessionId: data.session?.id ?? null });
    if (state.title !== data.title || state.sessionId !== (data.session?.id ?? null)) {
      store.updateReview(projectId, branch, (r) => {
        r.title = data.title;
        r.sessionId = data.session?.id ?? null;
      });
    }
    return { data, state };
  },
  updateReview: async (projectId, branch, patch) => {
    if (patch.type === 'start') store.reopenReview(projectId, branch);
    const next = store.updateReview(projectId, branch, (r) => applyPatch(r, patch));
    // Screens you go back to read the newest state from this.
    win?.webContents.send('review-state-changed', next);
    return next;
  },
  finish: (req) => actions.finish(req),
  openSessionFile: async (file) => {
    shell.showItemInFolder(file);
  },
  walkthroughJob: async (projectId, branch) => writer.job(projectId, branch),
  writeWalkthrough: (projectId, branch, opts) => writer.start(projectId, branch, opts),
  cancelWalkthrough: async (projectId, branch) => writer.cancel(projectId, branch),
  ask: (projectId, branch, stepKey, kind, text) => conversations.ask(projectId, branch, stepKey, kind, text),
  fileLines: (projectId, branch, path, side, from, to) => projects.fileLines(projectId, branch, path, side, from, to),
  searchCode: (projectId, branch, query) => projects.searchCode(projectId, branch, query),
  shareWalkthrough: (projectId, branch) => writer.share(projectId, branch),
  cancelExchange: async (projectId, branch, id) => conversations.cancel(projectId, branch, id),
};

function registerIpc() {
  for (const [name, fn] of Object.entries(api)) {
    ipcMain.handle(`api:${name}`, (_e, ...args) => (fn as (...a: unknown[]) => unknown)(...args));
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: 'Hunkdory',
    // On a Mac the app draws its own top bar: the traffic lights sit inside it, centred on its first row.
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 20, y: 26 } } : {}),
    backgroundColor: windowBackground(),
    icon: ICON,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.once('ready-to-show', () => win?.show());
  // Full screen hides the traffic lights, so the top bar can drop the room it keeps for them.
  win.on('enter-full-screen', () => win?.webContents.send('full-screen', true));
  win.on('leave-full-screen', () => win?.webContents.send('full-screen', false));
  // Back and forward like a browser: mouse buttons arrive as app commands on Windows and Linux, swipes on a Mac trackpad.
  win.on('app-command', (_e, cmd) => {
    if (cmd === 'browser-backward' || cmd === 'browser-forward') win?.webContents.send('navigate', cmd === 'browser-backward' ? 'back' : 'forward');
  });
  win.on('swipe', (_e, dir) => {
    if (dir === 'left' || dir === 'right') win?.webContents.send('navigate', dir === 'left' ? 'back' : 'forward');
  });
  // Closing the window keeps Hunkdory in the menu bar. Quit from the tray or with Cmd+Q.
  win.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    win?.hide();
  });
  // Nothing in the app should navigate away or open new windows. Links go to the browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());

  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else win.loadFile(join(__dirname, '../renderer/index.html'));
}

function showWindow() {
  if (!win) createWindow();
  win!.show();
  win!.focus();
}

function createTray() {
  tray = new Tray(trayIcon());
  tray.setToolTip('Hunkdory');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open Hunkdory', click: showWindow },
      { type: 'separator' },
      { label: 'Quit Hunkdory', click: () => app.quit() },
    ])
  );
}

app.on('second-instance', showWindow);
app.on('activate', showWindow);
app.on('before-quit', () => {
  quitting = true;
  writer.stopAll();
  conversations.stopAll();
});

app.whenReady().then(() => {
  if (process.platform === 'darwin') app.dock?.setIcon(ICON);
  // Before the window opens, so a dark theme never flashes white first.
  nativeTheme.themeSource = store.settings().theme;
  nativeTheme.on('updated', () => win?.setBackgroundColor(windowBackground()));
  settleStaleRuns();
  conversations.settleStale();
  registerIpc();
  createWindow();
  createTray();
});
