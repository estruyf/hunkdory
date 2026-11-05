// The agent Hunkdory asks to write a walkthrough, answer a question or make a change.
// Claude Code is the only one today; Copilot and any ACP agent come later behind the same interface.

/** How much of the repo a run may touch. */
export type Access = 'git-only' | 'read' | 'edit';

export interface AssistantSession {
  id: string;
  /** 'copy' starts the run from a branch of the session, so the original stays untouched; 'continue' resumes it in place. */
  mode: 'copy' | 'continue';
  /** Claude-specific: the config dir (~/.claude, ~/.claude-work, …) the session lives in. Other assistants ignore it. */
  configDir?: string | null;
}

export interface AssistantResult {
  /** The final message. */
  text: string;
  structured: Record<string, unknown> | null;
  /** What the run cost, when the CLI says. */
  costUsd?: number;
}

export interface AssistantRun {
  done: Promise<AssistantResult>;
  kill(): void;
}

export interface RunOptions {
  cwd: string;
  prompt: string;
  access: Access;
  session: AssistantSession | null;
  /** Wanted structured output, checked against this JSON schema. */
  schema?: object;
  /** Extra shell commands allowed besides read-only git, written the way the assistant's CLI expects. Only used with a 'continue' session. */
  allowBash?: string[];
  /** The ref to read the change from when cwd isn't checked out to it. Only an ACP agent's fs/read_text_file needs this; others read it from the prompt instead. */
  headRef?: string | null;
  logFile: string;
  timeoutMs: number;
  onActivity?: (line: string) => void;
}

export interface SendBackSession {
  id: string;
  /** Where the session's agent works: its worktree or folder. */
  cwd: string;
  configDir?: string | null;
}

export interface SendBackOptions {
  session: SendBackSession;
  prompt: string;
  logFile: string;
  /** Shell commands allowed besides read-only git, e.g. the project's verifier. */
  allowBash: string[];
  /** Called once the detached run ends, successfully or not. */
  onExit?: (ok: boolean, message: string) => void;
}

export interface SendBackHandle {
  pid: number | undefined;
  logFile: string;
}

export interface Assistant {
  id: string;
  /** For UI text: "Ask Copilot", "Starting Copilot…". */
  name: string;
  /** Whether the CLI is installed, with a reason when it isn't. */
  available(): Promise<{ ok: true } | { ok: false; reason: string }>;
  run(opts: RunOptions): Promise<AssistantRun>;
  /** A detached, fire-and-forget run that continues a session in place. Used for "send back" after a review. */
  sendBack(opts: SendBackOptions): Promise<SendBackHandle>;
}
