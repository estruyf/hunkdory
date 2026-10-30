// Data model shared by the main process and the renderer.
// Stored: Project, Review, Comment. Everything else is derived from git, wtv and sessions.

export type RiskLevel = 'high' | 'medium' | 'low';
export type ReviewOrder = 'story' | 'risk' | 'file';

export interface Project {
  id: string;
  name: string;
  path: string;
  /** Branch or ref to compare against when a session doesn't say where it branched from. */
  baseBranch: string;
  remote: string | null;
  watch: Watch;
  /** Set when you linked the GitHub remote: "owner/name". Hunkdory only talks to GitHub (through gh) when this is set. */
  github: string | null;
  /** Branches you picked with "Review a branch". They stay in the inbox whatever the watch rule. */
  tracked?: string[];
  /** Branches you ignored, e.g. because someone else reviews them on GitHub. They stay out of "Waiting for you" until you bring them back. */
  ignored?: string[];
  /** Bases you picked for one branch, by branch name. They win over the project's base and a PR's. */
  bases?: Record<string, string>;
  /**
   * Whether Hunkdory may have Claude Code write a walkthrough when a branch opens without one.
   * Unset until you answer: until then nothing is sent to Claude unless you click "Write one".
   */
  writeWalkthroughs?: boolean;
  addedAt: string;
}

/** A branch you can compare a review against, with how many of the branch's commits aren't on it. */
export interface BaseChoice {
  name: string;
  commits: number;
}

/** A branch you can pick to review, for the branch picker. */
export interface BranchChoice {
  name: string;
  remote: boolean;
  updatedAt: string;
  author: string;
  subject: string;
  ahead: number;
  inInbox: boolean;
}

/** What lands in the inbox. Any mix of the three: a branch more than one of them finds shows up once. */
export interface Watch {
  /** Every local branch with commits on top of the base, whoever made it. Integration branches stay out. */
  anyBranch: boolean;
  /** Branch globs, comma separated, like "claude/*, feat/*". Null: off. */
  pattern: string | null;
  /** Every open pull request, from anyone. Needs the GitHub remote. */
  pullRequests: boolean;
}

export interface PullRequest {
  number: number;
  title: string;
  headRefName: string;
  headRefOid: string;
  baseRefName: string;
  author: string;
  isBot: boolean;
  isDraft: boolean;
  url: string;
  body: string;
  updatedAt: string;
  /** Opened by the GitHub Copilot coding agent. */
  copilot: boolean;
  /** CI and other checks on the head commit, as GitHub reports them. */
  checks: CheckItem[];
  /** Logins. */
  assignees: string[];
  /** Reviewers asked for and not yet heard from: logins, and teams as "org/team". */
  requestedReviewers: string[];
  /** Each reviewer's latest review. */
  reviews: PrReview[];
}

export interface PrReview {
  login: string;
  state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED';
}

export interface CheckItem {
  name: string;
  state: 'pass' | 'fail' | 'pending' | 'skipped';
  url: string | null;
}

/** One pull request in a stack: each one's base is the head of the one below it. */
export interface StackEntry {
  number: number;
  title: string;
  /** The branch Hunkdory knows this PR by, to open its review. */
  branch: string;
  url: string;
  current: boolean;
  /** Your review of it, if you started one. */
  status: ReviewState['status'] | null;
}

/** A Claude Code session, parsed from ~/.claude/projects/<encoded cwd>/<id>.jsonl. */
/** A test command the agent ran in its session, and what came out. */
export interface TestRun {
  /** The command, shortened for display. */
  command: string;
  /** From the output, since a piped run (`npm test | tail`) exits 0 even when tests fail. */
  result: 'passed' | 'failed' | 'unknown';
  at: string;
}

export interface SessionInfo {
  id: string;
  file: string;
  /** Claude Code config dir the session lives in. Resuming needs CLAUDE_CONFIG_DIR set to it unless it's ~/.claude. */
  configDir: string;
  /** Last working directory the session ran in. `claude --resume` must run from here. */
  cwd: string;
  /** Every branch the session ran on, ordered by last use, with when it was first and last seen. */
  branches: { name: string; firstSeen: string; lastSeen: string }[];
  /** Branch the session's worktree was created from, when it ran in a Claude Code worktree. */
  originalBranch: string | null;
  worktreePath: string | null;
  firstPrompt: string | null;
  title: string | null;
  startedAt: string | null;
  endedAt: string | null;
  /** Test commands the agent ran, oldest first. */
  testRuns: TestRun[];
  /** When the agent last changed a file with Edit or Write. Edits through Bash don't show up here. */
  lastEditAt: string | null;
}

export type Checkout =
  | { kind: 'worktree'; path: string }
  | { kind: 'main'; path: string }
  | { kind: 'none' };

/** An agent branch that may need a review. */
export interface BranchInfo {
  projectId: string;
  name: string;
  checkout: Checkout;
  /** Ref to diff against, e.g. "develop" or "refs/reviewer/base/develop" for a pull request. */
  baseRef: string;
  /** Base as people call it, for display. */
  baseName: string;
  /** You picked the base for this branch, instead of Hunkdory. */
  baseChosen: boolean;
  /** Ref with the changes: the branch, or "refs/reviewer/pr/<n>" for a pull request. */
  headRef: string;
  headSha: string;
  pr: PullRequest | null;
  /** Picked by you with "Review a branch". */
  tracked: boolean;
  dirtyFiles: number;
  sessionIds: string[];
}

export interface DiffLine {
  kind: 'add' | 'del' | 'ctx';
  oldN: number | null;
  newN: number | null;
  text: string;
}

/** Where some text appears in a branch: its checkout, or its commit when it has none. */
export interface CodeSearchResult {
  matches: { path: string; line: number; text: string }[];
  /** More matches than shown: narrow the search. */
  truncated: boolean;
}

export interface Risk {
  code: string;
  severity: RiskLevel;
  label: string;
  /** What set it off: the matched text and its line, or a null line for a match on the path. */
  match?: { term: string; line: number | null };
}


/** A wtv hunk, plus what the review screen needs to show it. */
export interface HunkView {
  id: string;
  path: string;
  oldPath: string | null;
  status: 'added' | 'deleted' | 'modified' | 'renamed';
  untracked: boolean;
  synthetic: string | null;
  bucket: 'narrated' | 'unnarrated' | 'noise' | 'generated';
  level: RiskLevel | 'none';
  risks: Risk[];
  added: number;
  removed: number;
  rangeLabel: string;
  lines: DiffLine[];
  note: string | null;
}

export type WalkthroughSource = 'agent' | 'reviewer' | 'skeleton';

/** Hunkdory writing a walkthrough for a branch that has none. Lives in memory while the app runs. */
export interface WalkthroughJob {
  projectId: string;
  branch: string;
  status: 'running' | 'done' | 'failed' | 'cancelled';
  startedAt: string;
  finishedAt: string | null;
  /** What the run is doing right now, like "Reading src/api.ts". */
  activity: string | null;
  /** 2 when the first walkthrough missed hunks and Claude is filling the gaps. */
  attempt: number;
  error?: string;
}

export type StepSource = 'chapter' | 'unnarrated' | 'skeleton' | 'skipped';

export interface Step {
  /** Stable across reloads: survives line shifts, changes when the step's content changes. */
  key: string;
  /** Position in story order, 0-based. */
  index: number;
  title: string;
  why: string;
  checks: string[];
  risk: RiskLevel;
  outsideTask: boolean;
  source: StepSource;
  hunkIds: string[];
  files: string[];
  added: number;
  removed: number;
}

export interface AttentionFlag {
  severity: 'high' | 'medium';
  title: string;
  detail: string;
  stepKey: string | null;
}

export interface ReviewData {
  projectId: string;
  projectName: string;
  /** Tests the agents ran in the branch's sessions; null without a session. */
  agentTests: { runs: TestRun[]; lastEditAt: string | null } | null;
  /** The project's answer to letting Claude write walkthroughs; null when you haven't answered yet. */
  writeWalkthroughs: boolean | null;
  branch: string;
  baseRef: string;
  /** You picked the base for this branch, instead of Hunkdory. */
  baseChosen: boolean;
  baseSha: string;
  head: string;
  pr: PullRequest | null;
  /** You opened the pull request, so GitHub won't take your approval on it. */
  prByYou: boolean;
  /** A local branch Hunkdory may merge or delete. False for pull requests and remote-only branches. */
  local: boolean;
  /** Who wrote the last commit, shown when no agent session is linked. */
  author: string | null;
  /** Who wrote the walkthrough: the branch's author or agent, Hunkdory itself, or nobody (wtv's one-step-per-file fallback). */
  walkthrough: WalkthroughSource;
  intent: string | null;
  title: string;
  prompt: string | null;
  session: SessionInfo | null;
  sessionCount: number;
  files: number;
  added: number;
  removed: number;
  steps: Step[];
  hunks: Record<string, HunkView>;
  attention: AttentionFlag[];
  ok: boolean;
  minutes: number;
  ask: AskAbility;
  /** Which agent made the branch, when Hunkdory can tell. */
  agent: 'claude-code' | 'copilot' | null;
  /** The commit under review, and whether uncommitted work is part of it. */
  headSha: string;
  dirty: boolean;
  /** Pull requests this one sits on and that sit on it, bottom first. Null when it isn't stacked. */
  stack: { base: string; prs: StackEntry[] } | null;
  /** Where Hunkdory's walkthrough came from when a teammate shared it on the PR. */
  sharedWalkthrough: { url: string; by: string } | null;
  /** The linked GitHub repo ("owner/name"), or null when the project has none. */
  repo: string | null;
}

/** A question about a step, or a change you asked Claude to make there, with how it went. */
/** Your answer to one of a step's questions: it holds, it doesn't and you want a change, or you'd like to ask first. */
export type CheckAnswer = 'yes' | 'no' | 'unsure';

export interface Exchange {
  id: string;
  stepKey: string;
  /** The step's title when you asked, so the thread still reads well if the step changes. */
  stepTitle: string;
  kind: 'question' | 'change';
  text: string;
  /** The step's question (its index in `checks`) this follows up on. It shows under that question instead of in the Ask panel. */
  check?: number;
  /** Who handled it: a copy of the session that wrote the branch, that session itself, or a fresh Claude Code run. */
  by: 'session-copy' | 'session' | 'fresh';
  status: 'running' | 'done' | 'failed' | 'cancelled';
  /** What the run is doing right now, while it runs. */
  activity: string | null;
  /** The answer, or for a change, Claude's summary of what it did. Markdown. */
  reply: string | null;
  error?: string;
  at: string;
  finishedAt: string | null;
}

/** What "Ask Claude" can do on a branch, and why not when it can't. */
export interface AskAbility {
  question: { by: Exchange['by'] };
  change: { by: Exchange['by']; where: string } | { by: null; reason: string };
}

export interface Comment {
  id: string;
  stepKey: string;
  /** Set for a comment on one line of the diff. */
  hunkId: string | null;
  line: number | null;
  path?: string | null;
  /** Which side of the diff the line is on: RIGHT for the new file, LEFT for removed lines. GitHub's terms. */
  side?: 'LEFT' | 'RIGHT' | null;
  body: string;
  createdAt: string;
}

/** `github` posts your review on the pull request. */
export type Decision = 'merge' | 'send-back' | 'discard' | 'github';
export type GitHubEvent = 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT';

export interface DecisionRecord {
  kind: Decision;
  note: string;
  dropStepKeys: string[];
  at: string;
  result: 'ok' | 'running' | 'failed';
  message: string;
  /** For send-back: where the headless agent run logs to, and its process. */
  logFile?: string;
  pid?: number;
  /** The branch as you saw it when you decided, to tell what changed when it comes back. */
  headSha?: string;
  hunkIds?: string[];
  /**
   * For a review posted on GitHub. `url` is the review, null when nothing was posted (a merge with no
   * comments); `prUrl` is the pull request itself. Records from before `prUrl` existed don't have it.
   */
  github?: { event: GitHubEvent; url: string | null; prUrl?: string };
}

export interface ReviewState {
  id: string;
  projectId: string;
  branch: string;
  sessionId: string | null;
  title: string;
  order: ReviewOrder;
  startedAt: string | null;
  updatedAt: string;
  /** Step key → hunk ids at the time it was marked reviewed. A step counts as reviewed only while they still match. */
  reviewed: Record<string, string[]>;
  comments: Comment[];
  decision: DecisionRecord | null;
  /** `reviewed`: your review is on GitHub and the PR hasn't changed since. */
  status: 'open' | 'merged' | 'sent-back' | 'discarded' | 'reviewed';
  /** Earlier passes over this branch, newest last, e.g. before the agent worked on your feedback. */
  rounds?: { decision: DecisionRecord; comments: Comment[]; reviewed: Record<string, string[]> }[];
  /** Questions and change requests per step, oldest first. */
  exchanges?: Exchange[];
  /** Review plan decisions you made, by decision id: fine as is, or needs a fix (for changes outside the task: drop them). */
  settled?: Record<string, 'fine' | 'fix'>;
  /** Your answers to a step's "check these" questions, by step key and question index. */
  answers?: Record<string, Record<number, CheckAnswer>>;
  /** What should change, for questions you answered "Needs a change", by step key and question index. */
  answerNotes?: Record<string, Record<number, string>>;
  /** Summary kept for the inbox once the branch is gone. */
  summary: { files: number; added: number; removed: number; steps: number } | null;
}

export interface InboxItem {
  projectId: string;
  projectName: string;
  branch: string;
  title: string;
  agent: string;
  files: number;
  added: number;
  removed: number;
  steps: number;
  minutes: number;
  flags: string[];
  updatedAt: string | null;
  walkthrough: WalkthroughSource;
  pr: (Pick<PullRequest, 'number' | 'isDraft' | 'url' | 'assignees' | 'requestedReviewers' | 'reviews'> & { author: string | null }) | null;
  /** Who opened it: the PR's author on GitHub, or for a local branch the author of its newest commit. */
  openedBy: string | null;
  /** You did: your gh login for a PR, your git user.email or user.name for a local branch. */
  openedByYou: boolean;
  checks: CheckItem[];
  /** You reviewed or sent it back, and the branch changed since. */
  updatedSinceReview: boolean;
  tracked: boolean;
  review: { status: ReviewState['status']; reviewedSteps: number } | null;
  /** Another inbox branch this one starts from: its changes show up in this review too. */
  buildsOn: { branch: string; pr: number | null } | null;
  /** You ignored it. Its size, steps and flags aren't worked out. */
  ignored: boolean;
  error?: string;
}

export interface FoundFolder {
  name: string;
  path: string;
  sessions: number;
  lastActive: string;
}

export interface RepoCheck {
  path: string;
  isRepo: boolean;
  root: string | null;
  baseBranch: string | null;
  branches: string[];
  remote: string | null;
  /** Where sessions for this repo were found, one entry per Claude Code config dir. */
  sessionSources: { dir: string; sessions: number }[];
  sessionCount: number;
  error?: string;
}

/** Why the inbox shows what it shows for one project. */
export interface ProjectScan {
  projectId: string;
  sessions: number;
  branchesSeen: number;
  /** Branches sessions worked on that no longer exist locally. */
  gone: number;
  /** Branches with nothing left to review: merged, or no commits on top of their base. */
  upToDate: number;
  waiting: number;
  pullRequests: number | null;
  error?: string;
}

export interface FinishRequest {
  projectId: string;
  branch: string;
  kind: Decision;
  note: string;
  dropStepKeys: string[];
  /** Merge only: commit uncommitted changes in the branch's worktree first. */
  commitFirst?: boolean;
  /** Discard only: also remove the worktree and delete the branch. */
  deleteBranch?: boolean;
  /** GitHub only: approve, request changes, or just comment. */
  event?: GitHubEvent;
  /** Merge of a local branch only: push it and open a pull request instead of merging locally. */
  openPr?: { title: string; draft: boolean };
}

export interface FinishResult {
  ok: boolean;
  message: string;
  /** Merge can't go ahead because the branch has uncommitted changes. */
  needsCommit?: number;
  review?: ReviewState;
}

/** The API the preload script exposes on window.api. */
/** How the app looks. System follows macOS; Light and Dark override it. */
export type Theme = 'system' | 'light' | 'dark';

/** App-wide settings, kept in the store next to your projects. */
export interface AppSettings {
  theme: Theme;
}

/** What to put in a bug report. */
export interface AppInfo {
  version: string;
  electron: string;
  chrome: string;
  node: string;
  os: string;
}

export interface ReviewerApi {
  listProjects(): Promise<Project[]>;
  checkFolder(path: string): Promise<RepoCheck>;
  chooseFolder(): Promise<string | null>;
  foundOnThisMac(): Promise<FoundFolder[]>;
  addProject(input: ProjectInput): Promise<Project>;
  updateProject(id: string, input: Omit<ProjectInput, 'path'>): Promise<Project>;
  removeProject(id: string): Promise<void>;
  /** Lets Claude write walkthroughs for a project's branches without one, or not. */
  setWriteWalkthroughs(projectId: string, on: boolean): Promise<void>;
  /** Links the GitHub remote: checks gh can see the repo. Returns "owner/name". */
  checkGitHub(path: string): Promise<string>;
  listBranches(projectId: string): Promise<BranchChoice[]>;
  trackBranch(projectId: string, branch: string): Promise<void>;
  /** Takes a branch out of the inbox, or (`on` false) brings it back. */
  ignoreBranch(projectId: string, branch: string, on: boolean): Promise<void>;
  /** Branches a review could compare against, the ones with the fewest commits to review first. */
  listBases(projectId: string, branch: string): Promise<BaseChoice[]>;
  /** Compares one branch against `base`, whatever the project's base. `null` goes back to Hunkdory's pick. */
  setBase(projectId: string, branch: string, base: string | null): Promise<void>;
  openExternal(url: string): Promise<void>;
  /** `me` is who gh is signed in as, null without GitHub. */
  inbox(opts?: { refresh?: boolean }): Promise<{ waiting: InboxItem[]; done: ReviewState[]; scans: ProjectScan[]; me: string | null }>;
  loadReview(projectId: string, branch: string, opts?: { refresh?: boolean }): Promise<{ data: ReviewData; state: ReviewState }>;
  updateReview(projectId: string, branch: string, patch: ReviewPatch): Promise<ReviewState>;
  finish(req: FinishRequest): Promise<FinishResult>;
  openSessionFile(file: string): Promise<void>;
  walkthroughJob(projectId: string, branch: string): Promise<WalkthroughJob | null>;
  /** Every walkthrough run since the app started, for the sidebar. */
  walkthroughJobs(): Promise<WalkthroughJob[]>;
  /** Has Hunkdory write a walkthrough. `auto` only starts for a branch without one, once per diff. */
  writeWalkthrough(projectId: string, branch: string, opts?: { auto?: boolean }): Promise<WalkthroughJob | null>;
  /** Brings Hunkdory's walkthrough up to date with a diff that changed, keeping its chapters. Null when it still covers the diff. */
  updateWalkthrough(projectId: string, branch: string): Promise<WalkthroughJob | null>;
  cancelWalkthrough(projectId: string, branch: string): Promise<void>;
  /** Asks Claude about a step, or to change something there. Returns the review with the new exchange. */
  ask(projectId: string, branch: string, stepKey: string, kind: Exchange['kind'], text: string, check?: number): Promise<ReviewState>;
  cancelExchange(projectId: string, branch: string, exchangeId: string): Promise<void>;
  /** Lines `from`..`to` (1-based, inclusive) of a file on one side of the diff, for showing more context. */
  fileLines(projectId: string, branch: string, path: string, side: 'old' | 'new', from: number, to: number): Promise<{ lines: string[]; total: number }>;
  searchCode(projectId: string, branch: string, query: string): Promise<CodeSearchResult>;
  /** Posts Hunkdory's walkthrough on the pull request, or updates the one it posted before. */
  shareWalkthrough(projectId: string, branch: string): Promise<{ url: string }>;
  settings(): Promise<AppSettings>;
  /** Applies the theme to the window right away and keeps it for the next launch. */
  setTheme(theme: Theme): Promise<AppSettings>;
  appInfo(): Promise<AppInfo>;
}

export interface ProjectInput {
  path: string;
  /** What the app calls it. Trimmed; empty means the folder's name. Left out on update: keep the current one. */
  name?: string;
  baseBranch: string;
  watch: Watch;
  github: string | null;
  /** Left out: keep what the project had. */
  writeWalkthroughs?: boolean;
}

export type ReviewPatch =
  | { type: 'start'; order: ReviewOrder }
  | { type: 'order'; order: ReviewOrder }
  | { type: 'reviewed'; stepKey: string; hunkIds: string[]; on: boolean }
  | { type: 'comment'; stepKey: string; body: string }
  /**
   * Settles a review plan decision. `comment` is the line a "needs a fix" adds to the step's comment;
   * any other value takes it out again, so a decision you changed doesn't leave its old comment behind.
   */
  | { type: 'settle'; id: string; value: 'fine' | 'fix' | null; comment?: { stepKey?: string; body: string } }
  /**
   * Answers one of a step's questions. "Needs a change" and "Not sure" put a line for it in the step's comment, so it goes
   * with your review; `note` is what should change. Another answer replaces that line, `null` clears the answer.
   */
  | { type: 'answer'; stepKey: string; index: number; question: string; value: CheckAnswer | null; note?: string }
  /** Adds a line comment, or edits it when `id` is set. An empty body removes it. */
  | { type: 'line-comment'; id?: string; stepKey: string; hunkId: string; path: string; line: number; side: 'LEFT' | 'RIGHT'; body: string };
