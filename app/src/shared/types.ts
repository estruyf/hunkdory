// Data model shared by the main process and the renderer.
// Stored: Project, Review, Comment. Everything else is derived from git, wtv and sessions.

export type RiskLevel = 'high' | 'medium' | 'low';
export type ReviewOrder = 'story' | 'risk' | 'file';

/** What a project shows as its icon. */
export type ProjectIconValue = { kind: 'image'; dataUrl: string } | { kind: 'emoji'; value: string };
/** What you can pick for a project. `auto` goes back to what its repo has; `none` is the letter, even when the repo has an icon. */
export type ProjectIconChoice = { kind: 'auto' } | { kind: 'none' } | { kind: 'emoji'; value: string } | { kind: 'file'; path: string };
/** What's kept for a project you picked an icon for: an image is a copy in Hunkdory's own folder. */
export type StoredProjectIcon = { kind: 'none' } | { kind: 'emoji'; value: string } | { kind: 'file'; path: string };
/** The icon a project shows, and where it came from. Null `icon`: its letter. `path` is where in the repo it was found. */
export interface ProjectIconInfo {
  icon: ProjectIconValue | null;
  source: 'detected' | 'custom' | null;
  path: string | null;
}

export interface Project {
  id: string;
  name: string;
  path: string;
  /** Unset: whatever icon its repo has. */
  icon?: StoredProjectIcon;
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
  /** A Copilot session you said wasn't really this branch's (a "probably" match you unlinked). Claude Code sessions don't need this: it only ever knows the branches it actually ran on. */
  dismissedSessions?: string[];
  /**
   * Whether Hunkdory may have Claude Code write a walkthrough when a branch opens without one.
   * Unset until you answer: until then nothing is sent to Claude unless you click "Write one".
   */
  writeWalkthroughs?: boolean;
  /**
   * Who does the work: write walkthroughs, answer questions, make changes, send work back.
   * Unset means 'claude-code', so projects connected before this existed keep working. An ACP agent's id
   * is `acp:<the agent's id in AppSettings.acpAgents>`.
   */
  assistant?: string;
  /** What the AI review checks and how. Unset means the defaults in shared/aiReview.ts. */
  aiReview?: AiReviewSettings;
  addedAt: string;
}

export type ReviewArea = 'bugs' | 'accessibility' | 'security' | 'performance';

/** A project's AI review. It always runs with the project's own assistant, and only when you press the button. */
export interface AiReviewSettings {
  /** Offers the button on this project's reviews. */
  enabled: boolean;
  areas: ReviewArea[];
  /** The project's own rules for the review. Kept in Hunkdory, not the repo, so a branch can't change its own review. */
  instructions: string;
  /** `quick` works from the diff; `thorough` also reads the code around it. */
  depth: 'quick' | 'thorough';
  maxFindings: number;
}

/** A problem an AI review found on a changed line. */
export interface AiFinding {
  /** Stable across runs while the code is the same: a dismissed finding stays dismissed. */
  id: string;
  severity: 'high' | 'medium' | 'low';
  area: ReviewArea;
  title: string;
  /** The way it fails: what happens, and when. */
  fails: string;
  hunkId: string;
  path: string;
  line: number;
  side: 'LEFT' | 'RIGHT';
  dismissed: boolean;
  /** The line comment you made of it. It counts for as long as that comment exists. */
  commentId: string | null;
}

/** What one finished AI review found, and what it looked at. */
export interface AiReviewResult {
  finishedAt: string;
  /** The assistant's name, as it was when this ran. */
  assistant: string;
  areas: ReviewArea[];
  depth: AiReviewSettings['depth'];
  /** The diff it saw, to tell when the branch moved on. */
  hunkIds: string[];
  findings: AiFinding[];
  /** Findings dropped because they pointed at something the diff didn't change. */
  dropped: number;
  /** Findings left out because of the project's limit. */
  cut: number;
  /** What the run cost, when the assistant says. */
  costUsd: number | null;
}

/** The AI review of a branch. A new run keeps the last result until it has a new one. */
export interface AiReview {
  status: 'running' | 'done' | 'failed' | 'cancelled';
  activity: string | null;
  error: string | null;
  startedAt: string;
  result: AiReviewResult | null;
}

/** A branch you can compare a review against, with how many of the branch's commits aren't on it. */
export interface BaseChoice {
  name: string;
  commits: number;
}

/** A checkout with uncommitted work, for the branch picker: its edits can be reviewed on their own. */
export interface UncommittedChoice {
  branch: string;
  /** The folder, with ~ for your home folder. */
  path: string;
  where: 'main' | 'worktree';
  files: number;
  /** It's in your inbox as uncommitted changes already: open it rather than add it. */
  inInbox: boolean;
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
  /** Its branch lives in a fork: Hunkdory can't push to it. */
  fork: boolean;
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

/** One comment in a review thread on GitHub. */
export interface GitHubComment {
  id: string;
  author: string;
  body: string;
  at: string;
  url: string;
}

/** A conversation on a line of the pull request's diff on GitHub. */
export interface GitHubThread {
  /** GitHub's node id, to reply to it or resolve it. */
  id: string;
  path: string;
  /** The line it's on in the PR's current diff; null once the code it was on changed (outdated). */
  line: number | null;
  startLine: number | null;
  side: 'LEFT' | 'RIGHT';
  resolved: boolean;
  outdated: boolean;
  comments: GitHubComment[];
}

/** A review someone submitted on the pull request: their verdict, and what they wrote on top of their line comments. */
export interface GitHubReview {
  author: string;
  state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED';
  body: string;
  at: string;
  url: string;
}

/** What people said on the pull request on GitHub. */
export interface GitHubFeedback {
  reviews: GitHubReview[];
  threads: GitHubThread[];
}

/** An issue or PR that a branch's PR or prompt points at. */
export interface IssueRef {
  number: number;
  kind: 'issue' | 'pr';
  title: string;
  state: 'open' | 'closed' | 'merged';
  url: string;
  /** Issues only: a PR's own text is a review of its own. */
  body: string;
  /** Mentioned as "Fixes #1". GitHub's own link doesn't help here: it stays empty for a PR into a release branch. */
  closes: boolean;
}

export interface IssueRefs {
  /** For "#123" in other text, which wasn't looked up. */
  repoUrl: string;
  refs: IssueRef[];
  /** Numbers GitHub doesn't know, as a task number from another tracker: these aren't links. */
  missing: number[];
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
  /** New commits since you reviewed or sent it back in Hunkdory. */
  changed: boolean;
  /** Your latest review of it on GitHub, from Hunkdory or not. */
  github: PrReview['state'] | null;
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
  /** Which CLI this session belongs to. Resuming and the config dir below only mean anything for Claude Code. */
  agent: 'claude-code' | 'copilot';
  /** Claude Code config dir the session lives in. Resuming needs CLAUDE_CONFIG_DIR set to it unless it's ~/.claude. Null for Copilot. */
  configDir: string | null;
  /** Last working directory the session ran in. `claude --resume`/`copilot --resume` must run from here. */
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
  /** A pull request's checkout: commits in it that aren't on the PR yet. */
  ahead?: number;
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
  /** Only the uncommitted work on a base branch's checkout, against its last commit: no commits of its own to review. */
  uncommitted: boolean;
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

/** A walkthrough Hunkdory keeps in its own folder. */
export interface SavedWalkthrough {
  /** Milliseconds since the epoch. */
  writtenAt: number;
  bytes: number;
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
  /** The base the branch had when the run started. */
  baseSha: string;
  error?: string;
}

export type StepSource = 'chapter' | 'unnarrated' | 'skeleton' | 'skipped';

/** A choice the agent made in a step, by its own account. */
export interface AgentChoice {
  question: string;
  chose: string;
  why: string | null;
  /** What it set aside, with the reason when it gave one. */
  rejected: string[];
}

/** What behaves differently after a step, in the walkthrough's words. */
export interface BehaviourChange {
  before: string;
  after: string;
  example: string | null;
}

/** A file outside the diff that uses what a step changes. wtv checked that it's in the branch. */
export interface Dependent {
  path: string;
  what: string;
}

/** One thing the request asked for. `done` means the walkthrough found code for it, not that it works. */
export interface RequestedItem {
  item: string;
  status: 'done' | 'partly' | 'missing';
  note: string | null;
  stepKeys: string[];
}

/** One thing to do to see the change working. Shown, never run. */
export interface TryItStep {
  do: string;
  expect: string | null;
}

export interface DiagramNode {
  id: string;
  label: string;
  kind: string | null;
  files: string[];
  /** Code the change relies on but doesn't edit. */
  unchanged: boolean;
  /** The steps that change this box's files, in story order. */
  stepKeys: string[];
}

export interface DiagramEdge {
  from: string;
  to: string;
  label: string | null;
}

/** How the parts of a change connect. wtv checked the boxes against the diff; the arrows are the walkthrough's reading of the code. */
export interface ChangeDiagram {
  summary: string | null;
  nodes: DiagramNode[];
  edges: DiagramEdge[];
}

export interface Step {
  /** Stable across reloads: survives line shifts, changes when the step's content changes. */
  key: string;
  /** Position in story order, 0-based. */
  index: number;
  title: string;
  why: string;
  checks: string[];
  risk: RiskLevel;
  /** What could break, in the walkthrough's words. Null when there's none, or when it became the step's only question. */
  riskNote: string | null;
  outsideTask: boolean;
  /** Changes code without changing a test file. Says nothing about tests that already cover that code. */
  noTestChange: boolean;
  choices: AgentChoice[];
  behaviour: BehaviourChange | null;
  dependents: Dependent[];
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
  /** That base is a local branch behind origin, so the review shows commits already on its copy there. */
  staleBase: { remote: string; commits: number } | null;
  baseSha: string;
  head: string;
  pr: PullRequest | null;
  /** Your GitHub login, for a pull request. Null without one, or when gh can't tell. */
  githubLogin: string | null;
  /** You opened the pull request, so GitHub won't take your approval on it. */
  prByYou: boolean;
  /** A local branch Hunkdory may merge or delete. False for pull requests and remote-only branches. */
  local: boolean;
  /** Who wrote the last commit, shown when no agent session is linked. */
  author: string | null;
  /** Who wrote the walkthrough: the branch's author or agent, Hunkdory itself, or nobody (wtv's one-step-per-file fallback). */
  walkthrough: WalkthroughSource;
  intent: string | null;
  /** How this part of the code works today, for someone new to it. */
  background: string | null;
  requested: RequestedItem[];
  tryIt: TryItStep[];
  diagram: ChangeDiagram | null;
  title: string;
  prompt: string | null;
  session: SessionInfo | null;
  /** The session is a guess, not a sure match: Copilot CLI doesn't record which branch it ran on, unlike Claude Code. */
  sessionProbable: boolean;
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
  /** How many files aren't committed yet. */
  dirtyFiles: number;
  /** A pull request checked out on this Mac: commits made here that aren't on the PR yet. */
  ahead: number;
  /** Only the uncommitted work on a base branch: approving it commits it there instead of merging. */
  uncommitted: boolean;
  /** Pull requests this one sits on and that sit on it, bottom first. Null when it isn't stacked. */
  stack: { base: string; prs: StackEntry[] } | null;
  /** Reviews and line comments on the pull request on GitHub. Null without a PR, or when GitHub couldn't be read. */
  github: GitHubFeedback | null;
  /** What "#123" means in this review. Null when GitHub isn't linked. */
  references: IssueRefs | null;
  /** Hunkdory's walkthrough was written with what the agent said in its session, not only from the code and commits. */
  walkthroughFromSession: boolean;
  /** Where Hunkdory's walkthrough came from when a teammate shared it on the PR. */
  sharedWalkthrough: { url: string; by: string } | null;
  /** The linked GitHub repo ("owner/name"), or null when the project has none. */
  repo: string | null;
  /** The assistant this project uses for walkthroughs, questions and changes. Null for Manual: no AI involved. */
  assistant: { id: string; name: string } | null;
  aiReviewSettings: AiReviewSettings;
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
  question: { by: Exchange['by'] } | { by: null; reason: string };
  /** `checkout`: the branch is a pull request Hunkdory can check out in a worktree, so Claude has somewhere to change it. */
  change: { by: Exchange['by']; where: string } | { by: null; reason: string; checkout?: boolean };
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

/** One thing in a sent-back run's log: what the agent said (`text`), a tool it used, what the CLI printed, or why it failed. */
export interface RunLogEntry {
  kind: 'text' | 'tool' | 'output' | 'error';
  text: string;
}

/** Part of a session where the agent edited a step's files: what it was asked, what it said just before, and the edits. */
export interface StepTraceTurn {
  prompt: string | null;
  /** A subagent did this, so `prompt` is the task it was given. */
  subagent: boolean;
  at: string | null;
  entries: RunLogEntry[];
}

export interface StepTrace {
  turns: StepTraceTurn[];
  /** The sessions are a guess, not a sure match: see ReviewData.sessionProbable. */
  probable: boolean;
}

export interface RunLog {
  entries: RunLogEntry[];
  /** The start of a very long log was left out. */
  cut: boolean;
  running: boolean;
  /** How the run ended, once it has. */
  message: string;
  file: string;
}

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
  /** For uncommitted work you approved: the commit Hunkdory made of it. */
  commit?: string;
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
  /** Step key → the hunk ids you marked reviewed, as a whole or one by one. A step counts as reviewed only while they are exactly its hunks. */
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
  aiReview?: AiReview;
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
  /** Only the uncommitted work in the branch's folder, against its last commit. */
  uncommitted: boolean;
  error?: string;
}

export interface FoundFolder {
  name: string;
  path: string;
  icon: ProjectIconValue | null;
  sessions: number;
  lastActive: string;
}

/** What Hunkdory can use on this Mac, for onboarding. */
export interface SetupStatus {
  git: boolean;
  gh: { installed: boolean; signedIn: boolean; login: string | null };
  assistants: AssistantChoice[];
}

/** What a repo's inbox would hold, before you connect it. */
export interface InboxPreview {
  /** Local branches with commits on top of the base. */
  branches: number;
  /** Open pull requests, up to the 100 Hunkdory reads. Null without a linked repo, or when they couldn't be read. */
  pullRequests: number | null;
  error?: string;
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
  /** The icon the repo has. */
  icon: ProjectIconInfo;
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
  /** The branch as you last saw it: approving, merging or deleting stops when it has changed since. */
  seen: { headSha: string; hunkIds: string[] };
  /** Merge only: commit uncommitted changes in the branch's worktree first. */
  commitFirst?: boolean;
  /** Merge of uncommitted work on a base branch only: the message of the commit it becomes. */
  commitMessage?: string;
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
  /** Nothing happened: the branch changed since you last saw it. */
  changed?: boolean;
  review?: ReviewState;
}

/** The API the preload script exposes on window.api. */
/** How the app looks. System follows macOS; Light and Dark override it. */
export type Theme = 'system' | 'light' | 'dark';

/** One agent speaking the Agent Client Protocol, configured once and usable by any project. */
export interface AcpAgentConfig {
  id: string;
  name: string;
  command: string;
  args: string[];
}

/** App-wide settings, kept in the store next to your projects. */
/** A code editor Hunkdory can open a branch's folder in. */
export interface EditorChoice {
  id: string;
  name: string;
  /** The app's name in /Applications, without .app. */
  app: string;
}

export interface AppSettings {
  theme: Theme;
  /** The editor to open folders in, by id. Null: the first one installed. */
  editor: string | null;
  /** ACP agents you've added (Gemini, codex-acp, or anything else), for any project to pick as its assistant. */
  acpAgents: AcpAgentConfig[];
}

/** What to put in a bug report. */
export interface AppInfo {
  version: string;
  electron: string;
  chrome: string;
  node: string;
  os: string;
}

/** One assistant Hunkdory can be connected to, for the Connect screen's choice. */
export interface AssistantChoice {
  id: string;
  name: string;
  available: boolean;
  /** Why it's disabled, when it is. */
  reason?: string;
}

export interface ReviewerApi {
  listProjects(): Promise<Project[]>;
  checkFolder(path: string): Promise<RepoCheck>;
  chooseFolder(): Promise<string | null>;
  foundOnThisMac(): Promise<FoundFolder[]>;
  /** What each project shows as its icon, by project id. */
  projectIcons(): Promise<Record<string, ProjectIconInfo>>;
  /** Asks for an image to use as an icon. Null when you cancel; throws when it can't be one. */
  chooseIconFile(): Promise<{ path: string; icon: ProjectIconValue } | null>;
  /** What's installed and signed in. `recheck` reads your shell's environment again, for after installing something. */
  setupStatus(opts?: { recheck?: boolean }): Promise<SetupStatus>;
  previewInbox(root: string, baseBranch: string, repo: string | null): Promise<InboxPreview>;
  /** Every assistant Hunkdory can be connected to, with whether it's installed. */
  listAssistants(): Promise<AssistantChoice[]>;
  addProject(input: ProjectInput): Promise<Project>;
  updateProject(id: string, input: Omit<ProjectInput, 'path'>): Promise<Project>;
  removeProject(id: string): Promise<void>;
  /** Lets Claude write walkthroughs for a project's branches without one, or not. */
  setWriteWalkthroughs(projectId: string, on: boolean): Promise<void>;
  /** Links the GitHub remote: checks gh can see the repo. Returns "owner/name". */
  checkGitHub(path: string): Promise<string>;
  listBranches(projectId: string): Promise<BranchChoice[]>;
  trackBranch(projectId: string, branch: string): Promise<void>;
  /** Checkouts with uncommitted work, main folder first. */
  listUncommitted(projectId: string): Promise<UncommittedChoice[]>;
  /** Reviews only the uncommitted work on a checked-out branch, against its last commit. */
  reviewUncommitted(projectId: string, branch: string): Promise<void>;
  /** Takes a branch out of the inbox, or (`on` false) brings it back. */
  ignoreBranch(projectId: string, branch: string, on: boolean): Promise<void>;
  /** Says a "probably" Copilot session match isn't this branch's, or (`on` false) brings it back. */
  unlinkSession(projectId: string, sessionId: string, on: boolean): Promise<void>;
  /** Branches a review could compare against, the ones with the fewest commits to review first. */
  listBases(projectId: string, branch: string): Promise<BaseChoice[]>;
  /** Compares one branch against `base`, whatever the project's base. `null` goes back to Hunkdory's pick. */
  setBase(projectId: string, branch: string, base: string | null): Promise<void>;
  /** Closes the window the way its close button does: Hunkdory stays in the menu bar. */
  closeWindow(): Promise<void>;
  openExternal(url: string): Promise<void>;
  /**
   * `me` is who gh is signed in as, null without GitHub. `projectId` reads that project again and keeps the others
   * as last read; `refetch` asks GitHub for its pull requests rather than use the ones read in the last minute.
   */
  /** The inbox as the last scan left it, even one from an earlier run; null with nothing to show. */
  inboxCached(): Promise<{ waiting: InboxItem[]; done: ReviewState[]; scans: ProjectScan[]; me: string | null } | null>;
  inbox(opts?: { refresh?: boolean; projectId?: string; refetch?: boolean }): Promise<{ waiting: InboxItem[]; done: ReviewState[]; scans: ProjectScan[]; me: string | null }>;
  loadReview(projectId: string, branch: string, opts?: { refresh?: boolean }): Promise<{ data: ReviewData; state: ReviewState }>;
  updateReview(projectId: string, branch: string, patch: ReviewPatch): Promise<ReviewState>;
  finish(req: FinishRequest): Promise<FinishResult>;
  /** Stops an agent you sent this branch back to. */
  cancelSendBack(projectId: string, branch: string): Promise<void>;
  openSessionFile(file: string): Promise<void>;
  /** The log of the agent run this branch was sent back to, in words; null when it has none. */
  runLog(projectId: string, branch: string): Promise<RunLog | null>;
  stepTrace(projectId: string, branch: string, files: string[]): Promise<StepTrace>;
  walkthroughJob(projectId: string, branch: string): Promise<WalkthroughJob | null>;
  /** Every walkthrough run since the app started, for the sidebar. */
  walkthroughJobs(): Promise<WalkthroughJob[]>;
  savedWalkthroughs(): Promise<SavedWalkthrough[]>;
  /** Null deletes them all. Resolves with how many went. */
  removeWalkthroughs(olderThanDays: number | null): Promise<number>;
  /** Has Hunkdory write a walkthrough. `auto` only starts for a branch without one, once per diff. */
  writeWalkthrough(projectId: string, branch: string, opts?: { auto?: boolean }): Promise<WalkthroughJob | null>;
  /** Brings Hunkdory's walkthrough up to date with a diff that changed, keeping its chapters. Null when it still covers the diff. */
  updateWalkthrough(projectId: string, branch: string): Promise<WalkthroughJob | null>;
  cancelWalkthrough(projectId: string, branch: string): Promise<void>;
  /** Asks Claude about a step, or to change something there. Returns the review with the new exchange. */
  ask(projectId: string, branch: string, stepKey: string, kind: Exchange['kind'], text: string, check?: number): Promise<ReviewState>;
  cancelExchange(projectId: string, branch: string, exchangeId: string): Promise<void>;
  /** Starts an AI review of the branch with the project's assistant. Returns the review with the run in it. */
  runAiReview(projectId: string, branch: string): Promise<ReviewState>;
  cancelAiReview(projectId: string, branch: string): Promise<void>;
  /** Replies to a review thread on the pull request. Returns what's on the PR now. */
  replyOnGitHub(projectId: string, branch: string, threadId: string, body: string): Promise<GitHubFeedback | null>;
  /** The editors installed on this Mac, and the one Hunkdory opens folders in (null when there's none). */
  editors(): Promise<{ installed: EditorChoice[]; current: EditorChoice | null }>;
  setEditor(id: string | null): Promise<AppSettings>;
  /** Opens the folder a branch is checked out in, in your editor. */
  openInEditor(projectId: string, branch: string): Promise<void>;
  /** Checks the pull request's branch out in a worktree, so Claude can change it. Returns the folder. */
  checkoutPullRequest(projectId: string, branch: string): Promise<string>;
  /** Commits what changed in the pull request's checkout and pushes it to the PR's branch. Returns what happened. */
  pushToPullRequest(projectId: string, branch: string, message: string): Promise<string>;
  /** Resolves a review thread on the pull request, or (`resolved` false) opens it again. */
  resolveOnGitHub(projectId: string, branch: string, threadId: string, resolved: boolean): Promise<GitHubFeedback | null>;
  /** Lines `from`..`to` (1-based, inclusive) of a file on one side of the diff, for showing more context. */
  fileLines(projectId: string, branch: string, path: string, side: 'old' | 'new', from: number, to: number): Promise<{ lines: string[]; total: number }>;
  searchCode(projectId: string, branch: string, query: string): Promise<CodeSearchResult>;
  /** Posts Hunkdory's walkthrough on the pull request, or updates the one it posted before. */
  shareWalkthrough(projectId: string, branch: string): Promise<{ url: string }>;
  settings(): Promise<AppSettings>;
  /** Applies the theme to the window right away and keeps it for the next launch. */
  setTheme(theme: Theme): Promise<AppSettings>;
  /** Adds (or, with `id` set, replaces) an ACP agent in app settings. */
  setAcpAgent(agent: Omit<AcpAgentConfig, 'id'> & { id?: string }): Promise<AppSettings>;
  removeAcpAgent(id: string): Promise<AppSettings>;
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
  /** Left out: keep what the project had. */
  assistant?: string;
  /** Left out: keep what the project had. */
  aiReview?: AiReviewSettings;
  /** Left out: keep what the project had. */
  icon?: ProjectIconChoice;
}

export type ReviewPatch =
  | { type: 'start'; order: ReviewOrder }
  | { type: 'order'; order: ReviewOrder }
  | { type: 'reviewed'; stepKey: string; hunkIds: string[]; on: boolean }
  /** Ticks one hunk of a step off, or back on. `hunkIds` are the step's hunks now. Ticking the last one makes the step reviewed. */
  | { type: 'reviewed-hunk'; stepKey: string; hunkIds: string[]; hunkId: string; on: boolean }
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
  /** Acts on one finding of the AI review. `comment` needs the step the line comment goes on. */
  | { type: 'ai-finding'; id: string; action: 'dismiss' | 'restore' | 'uncomment' }
  | { type: 'ai-finding'; id: string; action: 'comment'; stepKey: string }
  /** Adds a line comment, or edits it when `id` is set. An empty body removes it. */
  | { type: 'line-comment'; id?: string; stepKey: string; hunkId: string; path: string; line: number; side: 'LEFT' | 'RIGHT'; body: string };
