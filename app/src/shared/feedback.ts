// Where feedback goes, and what comes with it: the version, so a report says which build it's about. Pure.
import type { AppInfo } from './types.ts';

const NEW_ISSUE = 'https://github.com/estruyf/hunkdory/issues/new';

export const versionText = (i: AppInfo) => `Hunkdory ${i.version}\nElectron ${i.electron} · Chromium ${i.chrome} · Node ${i.node}\n${i.os}`;

/** A new GitHub issue with the version filled in. Nothing is sent until you submit it there, and you see all of it first. */
export function feedbackUrl(info: AppInfo | null): string {
  if (!info) return NEW_ISSUE;
  const body = `What happened, or what would you like?\n\n\n---\n${versionText(info)}\n`;
  return `${NEW_ISSUE}?body=${encodeURIComponent(body)}`;
}
