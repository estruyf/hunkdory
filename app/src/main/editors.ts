// Code editors on this Mac, to open a branch's folder in. macOS only: they're found as apps and opened with `open -a`.
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { EditorChoice } from '../shared/types.ts';

const run = promisify(execFile);

/** The editors Hunkdory looks for, most common first: the first one installed is the default. */
const KNOWN: EditorChoice[] = [
  { id: 'vscode', name: 'Visual Studio Code', app: 'Visual Studio Code' },
  { id: 'cursor', name: 'Cursor', app: 'Cursor' },
  { id: 'windsurf', name: 'Windsurf', app: 'Windsurf' },
  { id: 'zed', name: 'Zed', app: 'Zed' },
  { id: 'vscode-insiders', name: 'VS Code Insiders', app: 'Visual Studio Code - Insiders' },
  { id: 'vscodium', name: 'VSCodium', app: 'VSCodium' },
  { id: 'webstorm', name: 'WebStorm', app: 'WebStorm' },
  { id: 'sublime', name: 'Sublime Text', app: 'Sublime Text' },
  { id: 'nova', name: 'Nova', app: 'Nova' },
];

/** The known editors that are installed, in /Applications or your own Applications folder. */
export function installedEditors(): EditorChoice[] {
  const dirs = ['/Applications', join(homedir(), 'Applications')];
  return KNOWN.filter((e) => dirs.some((d) => existsSync(join(d, `${e.app}.app`))));
}

/** The editor you picked, while it's installed, else the first one found. Null when there's none. */
export function pickEditor(chosen: string | null): EditorChoice | null {
  const installed = installedEditors();
  return installed.find((e) => e.id === chosen) ?? installed[0] ?? null;
}

/** Opens a folder in the editor. */
export async function openInEditor(editor: EditorChoice, path: string): Promise<void> {
  await run('open', ['-a', editor.app, path]);
}
