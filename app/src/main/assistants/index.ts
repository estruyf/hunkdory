// Picks the Assistant for a project: Claude Code, Copilot, Manual, or any ACP agent configured in app
// settings, read from `project.assistant`. Unset means 'claude-code', so existing projects keep working.
import { AcpAssistant, type AcpAgentConfig } from './acp.ts';
import { ClaudeAssistant } from './claude.ts';
import { CopilotAssistant } from './copilot.ts';
import { ManualAssistant } from './manual.ts';
import type { Assistant } from './types.ts';

const claudeCode = new ClaudeAssistant();
const copilot = new CopilotAssistant();
const manual = new ManualAssistant();

/** The app's configured ACP agents, set once at startup (store.ts persists them in AppSettings). */
let acpAgents: AcpAssistant[] = [];

/** Rebuilds the ACP agents list from app settings. Call once at startup and whenever settings change. */
export function setAcpAgents(configs: AcpAgentConfig[]) {
  acpAgents = configs.map((c) => new AcpAssistant(c));
}

/** Every assistant Hunkdory can be connected to, for the Connect screen's choice, in preference order. */
export function allAssistants(): Assistant[] {
  return [claudeCode, copilot, ...acpAgents, manual];
}

/** Kept for existing callers that don't need the dynamic ACP agents reflected (tests, mostly). */
export const ASSISTANTS: Assistant[] = [claudeCode, copilot, manual];

export function assistantFor(project?: { assistant?: string } | null): Assistant {
  if (project?.assistant === 'manual') return manual;
  if (project?.assistant === 'copilot') return copilot;
  if (project?.assistant?.startsWith('acp:')) {
    const found = acpAgents.find((a) => a.id === project.assistant);
    if (found) return found;
  }
  return claudeCode;
}

export * from './types.ts';
export { READ_GIT, ISOLATED, describeTool, claudeArgs, ClaudeAssistant } from './claude.ts';
export { READ_GIT_SHELL, describeTool as describeCopilotTool, copilotArgs, parseCopilotLine, parseStructured as parseCopilotStructured, CopilotAssistant } from './copilot.ts';
export { AcpAssistant, decidePermission, readTextFile, runAcpTurn, AcpClient } from './acp.ts';
export type { AcpAgentConfig } from './acp.ts';
export { ManualAssistant };

