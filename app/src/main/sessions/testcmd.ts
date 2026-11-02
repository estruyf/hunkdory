// Spotting test runs in a tool-call transcript. Shared between Claude Code's and Copilot's session
// readers: both pair a shell tool call with its result and need the same "was this a test, did it pass" rules.
import type { TestRun } from '../../shared/types.ts';

/**
 * A test runner in command position: at the start, or after &&, ;, | or (, optionally behind npx and env vars.
 * So `cd x && npm test | tail` counts, and `grep -rn "vitest"` doesn't.
 */
export const TEST_CMD =
  /(?:^|[;&|(]\s*)(?:\w+=\S+\s+)*(?:npx\s+)?(?:(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test\b|(?:\.\/)?(?:node_modules\/\.bin\/)?(?:vitest|jest|pytest|mocha)\b|playwright\s+test\b|(?:go|dotnet|cargo)\s+test\b|node\s+(?:--\S+\s+)*--test\b|(?:gulp|heft)\s+test\b)/m;

/** A command without its heredoc bodies: a script fed to python3 can mention npm test without running it. */
export function withoutHeredocs(cmd: string) {
  const out: string[] = [];
  let end: string | null = null;
  for (const line of cmd.split('\n')) {
    if (end) {
      if (line.trim() === end) end = null;
      continue;
    }
    out.push(line);
    end = line.match(/<<-?\s*['"]?(\w+)['"]?/)?.[1] ?? null;
  }
  return out.join('\n');
}

/** The interesting part of a command: without a leading `cd somewhere &&`, on one line. */
export function shortCommand(cmd: string) {
  const line = cmd.replace(/^\s*cd\s+\S+\s*&&\s*/, '').split('\n')[0].trim();
  return line.length > 90 ? `${line.slice(0, 87)}…` : line;
}

const FAILED = /\b[1-9]\d*\s+(?:failed|failing|failures?)\b|ℹ fail [1-9]|^\s*FAIL\b|✖|npm ERR!|Tests?:\s+[1-9]\d* failed/im;
const PASSED = /\b[1-9]\d*\s+(?:passed|passing)\b|ℹ pass [1-9]|^\s*PASS\b|✔|\bAll tests passed\b|^ok\b/im;

/** Passed, failed or unknown, from the exit status and the output that came back. */
export function testResult(isError: boolean, output: string): TestRun['result'] {
  if (isError || FAILED.test(output)) return 'failed';
  return PASSED.test(output) ? 'passed' : 'unknown';
}
