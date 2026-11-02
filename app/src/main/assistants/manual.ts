// Manual: no AI. Hunkdory never sends this project's code anywhere.
import type { Assistant, AssistantRun, RunOptions, SendBackHandle, SendBackOptions } from './types.ts';

const REASON = "This project is set to Manual, so Hunkdory doesn't send its code anywhere.";

export class ManualAssistant implements Assistant {
  id = 'manual';
  name = 'Manual';

  async available() {
    return { ok: true as const };
  }

  async run(_opts: RunOptions): Promise<AssistantRun> {
    throw new Error(REASON);
  }

  async sendBack(_opts: SendBackOptions): Promise<SendBackHandle> {
    throw new Error(REASON);
  }
}
