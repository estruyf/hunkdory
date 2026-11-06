// What to tell people about the project's assistant and what a project watches: the same words on every screen. Pure.
import type { Project, ProjectScan } from './types.ts';

type Named = { id: string; name: string };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Where the code goes on a run, for the choices that send it. Empty for an agent whose provider Hunkdory can't know. */
export function whereCodeGoes(a: Named): string {
  if (a.id === 'claude-code') return 'Like any Claude Code run, that goes to Anthropic.';
  if (a.id === 'copilot') return 'Like any Copilot run, that goes to GitHub.';
  return '';
}

/** What a run costs you, before you start one. */
export function usageNote(a: Named): string {
  if (a.id === 'claude-code') return 'It uses your Claude plan or API credit: about $0.30 on a small branch, more on a big one.';
  if (a.id === 'copilot') return 'It uses your Copilot premium requests.';
  return `It uses ${a.name}’s own usage.`;
}

/** Where to get an assistant that isn't installed. */
export const INSTALL_URL: Record<string, string> = {
  'claude-code': 'https://claude.com/claude-code',
  copilot: 'https://github.com/github/copilot-cli',
  gh: 'https://cli.github.com',
};

/** A failed run in words that say what to do next, not only what the CLI printed. */
export function explainRunFailure(a: Named, why: string): string {
  const signIn = a.id === 'claude-code' ? 'Run `claude` in a terminal and sign in with /login' : a.id === 'copilot' ? 'Run `copilot` in a terminal and sign in with /login' : `Sign in to ${a.name}`;
  if (/not logged in|\/login|log ?in again|invalid api key|authenticat|unauthori[sz]ed|\b401\b/i.test(why)) return `${a.name} isn't signed in. ${signIn}, then try again.`;
  if (/credit balance|quota|usage limit|limit reached|rate.?limit|\b429\b|premium request|out of credits/i.test(why)) return `${a.name} has run out of usage for now. Check your plan, or try again later.`;
  if (/overloaded|\b5(00|02|03|29)\b|ENOTFOUND|ECONNRE|ETIMEDOUT|network|connection error/i.test(why)) return `${a.name} couldn't reach its service. Check your connection and try again.`;
  if (/took longer than/.test(why)) return `${a.name} ${why.replace(/^it /, '')}, so Hunkdory stopped it. Try again, or ask about a smaller part.`;
  return `${a.name} stopped without an answer (${why}).`;
}

/** What a project's inbox is made of, in a few words. */
export function watchSummary(p: Pick<Project, 'watch' | 'github'>): string {
  const parts = [p.watch.anyBranch ? 'Local branches' : p.watch.pattern !== null ? `Branches matching ${p.watch.pattern}` : null, p.watch.pullRequests && p.github ? `pull requests on ${p.github}` : null, 'uncommitted changes'].filter(Boolean) as string[];
  const text = parts.join(', ').replace(/, ([^,]*)$/, ' and $1');
  return text[0]!.toUpperCase() + text.slice(1);
}

/** Pull requests could show up here, but the project doesn't ask for them. */
export const pullRequestsOff = (p: Pick<Project, 'watch' | 'remote'>) => !p.watch.pullRequests && !!p.remote?.startsWith('github.com/');

/** Why a project has nothing waiting, in numbers you can check. */
export function whyNothingWaits(p: Pick<Project, 'watch' | 'github'>, scan: ProjectScan): string {
  const why: string[] = [];
  if (p.watch.anyBranch || p.watch.pattern !== null) {
    const which = p.watch.anyBranch ? 'local branches' : `branches matching ${p.watch.pattern}`;
    why.push(`No ${which} with changes.`);
    if (scan.branchesSeen) why.push(`Agents worked on ${plural(scan.branchesSeen, 'branch', 'branches')}${scan.gone ? `, ${scan.gone} no longer here` : ''}${scan.upToDate ? `, ${scan.upToDate} with nothing left to review` : ''}.`);
  }
  if (p.watch.pullRequests && p.github && scan.pullRequests !== null) why.push(scan.pullRequests ? `${plural(scan.pullRequests, 'open pull request')}, none could be read.` : 'No open pull requests.');
  return why.join(' ');
}
