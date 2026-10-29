// Comparing folders the way you'd expect: "~/dev/web/", "/Users/me/dev/web" and a symlink to it are one folder.
import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

/** `~` at the start means your home folder. */
export const expandHome = (p: string, home = homedir()) => p.replace(/^~(?=\/|$)/, home);

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
