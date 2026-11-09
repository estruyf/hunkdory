// Code editors on this computer, to open a branch's folder in. On macOS they're found as apps and opened with `open -a`;
// on Windows by their program where their installer puts it, which is started with the folder.
import { execFile, spawn } from 'node:child_process';
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

/** Each editor's program on Windows, under %LOCALAPPDATA%\Programs (an install for you) or Program Files. */
const WINDOWS: Record<string, string> = {
  vscode: 'Microsoft VS Code\\Code.exe',
  cursor: 'cursor\\Cursor.exe',
  windsurf: 'Windsurf\\Windsurf.exe',
  zed: 'Zed\\Zed.exe',
  'vscode-insiders': 'Microsoft VS Code Insiders\\Code - Insiders.exe',
  vscodium: 'VSCodium\\VSCodium.exe',
  sublime: 'Sublime Text\\sublime_text.exe',
};

function windowsProgram(id: string, env = process.env): string | null {
  const roots = [env.LOCALAPPDATA && join(env.LOCALAPPDATA, 'Programs'), env.ProgramFiles, env['ProgramFiles(x86)']];
  const file = WINDOWS[id];
  return (file && roots.map((root) => root && join(root, file)).find((path) => path && existsSync(path))) || null;
}

/** The known editors that are installed, in /Applications or your own Applications folder (on Windows, where they install). */
export function installedEditors(): EditorChoice[] {
  if (process.platform === 'win32') return KNOWN.filter((e) => windowsProgram(e.id));
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
  if (process.platform !== 'win32') {
    await run('open', ['-a', editor.app, path]);
    return;
  }
  const program = windowsProgram(editor.id);
  if (!program) throw new Error(`${editor.name} isn't installed anymore.`);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(program, [path], { detached: true, stdio: 'ignore' });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}
