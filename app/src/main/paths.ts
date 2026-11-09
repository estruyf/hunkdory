// Comparing folders the way you'd expect: "~/dev/web/", "/Users/me/dev/web" and a symlink to it are one folder.
import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

/** `~` at the start means your home folder: `~/dev`, or on Windows `~\\dev` too. */
export const expandHome = (p: string, home = homedir(), platform = process.platform) => p.replace(platform === 'win32' ? /^~(?=[/\\]|$)/ : /^~(?=\/|$)/, home);

/**
 * A path the way git writes it, so it compares with what git says as a string: on Windows git uses `/`, while sessions
 * record `C:\\Users\\…`. Unchanged elsewhere.
 */
export const gitPath = (p: string, platform = process.platform) => (platform === 'win32' ? p.replaceAll('\\', '/') : p);

/**
 * One key per folder: home expanded, `.`/`..` and trailing slashes gone, and symlinks followed when the
 * folder exists (git reports /private/tmp where a session may say /tmp).
 */
export function pathKey(p: string, home = homedir()): string {
  const abs = resolve(expandHome(p.trim(), home));
  try {
    return realpathSync.native(abs);
  } catch {
    return abs;
  }
}
