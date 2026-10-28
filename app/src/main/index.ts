import { app, BrowserWindow, dialog, ipcMain, Menu, shell, Tray } from 'electron';
import { join, resolve } from 'node:path';
import { Store } from './store.ts';
import { Projects } from './projects.ts';
import { Actions } from './actions.ts';
import { GeneratedWalkthroughs, Writer } from './writer.ts';
import { Conversations } from './conversations.ts';
import { trayIcon } from './trayIcon.ts';
import type { ReviewerApi, ReviewPatch, ReviewState } from '../shared/types.ts';

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;

// Lets tests and demo runs use a throwaway store instead of your real reviews.
if (process.env.REVIEWER_USER_DATA) app.setPath('userData', process.env.REVIEWER_USER_DATA);
if (!app.requestSingleInstanceLock()) app.quit();

const store = new Store(join(app.getPath('userData'), 'store.json'));
const generated = new GeneratedWalkthroughs(join(app.getPath('userData'), 'walkthroughs'));
const projects = new Projects(store, generated);
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
        x.decision!.message = 'The agent run finished while Reviewer was closed.';
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
    if (patch.value === 'fix' && patch.comment) addToStepComment(r, patch.comment.stepKey, patch.comment.body);
  } else if (patch.type === 'answer') {
    r.answers ??= {};
    const forStep = (r.answers[patch.stepKey] ??= {});
    if (patch.value) forStep[patch.index] = patch.value;
    else delete forStep[patch.index];
  }
}

/** Appends a line to a step's comment, once. */
function addToStepComment(r: ReviewState, stepKey: string, line: string) {
  const text = line.trim();
  if (!text) return;
  const existing = r.comments.find((c) => c.stepKey === stepKey && !c.line);
  if (existing) {
    if (!existing.body.includes(text)) existing.body = `${existing.body.trim()}\n${text}`;
  } else r.comments.push({ id: crypto.randomUUID(), stepKey, hunkId: null, line: null, body: text, createdAt: new Date().toISOString() });
}

const api: ReviewerApi = {
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
  checkGitHub: (path) => projects.checkGitHub(path),
  listBranches: (projectId) => projects.listBranches(projectId),
  trackBranch: (projectId, branch) => projects.trackBranch(projectId, branch),
  openExternal: async (url) => {
    // Only links Reviewer shows itself, like a pull request on GitHub.
    if (/^https:\/\//.test(url)) await shell.openExternal(url);
  },
  inbox: async (opts) => {
    const { items: waiting, scans } = await projects.inbox(opts?.refresh);
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
    return { waiting, done, scans };
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
    return store.updateReview(projectId, branch, (r) => applyPatch(r, patch));
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
    title: 'Reviewer',
    backgroundColor: '#F6F7F9',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.once('ready-to-show', () => win?.show());
  // Closing the window keeps Reviewer in the menu bar. Quit from the tray or with Cmd+Q.
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
  tray.setToolTip('Reviewer');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open Reviewer', click: showWindow },
      { type: 'separator' },
      { label: 'Quit Reviewer', click: () => app.quit() },
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
  settleStaleRuns();
  conversations.settleStale();
  registerIpc();
  createWindow();
  createTray();
});
