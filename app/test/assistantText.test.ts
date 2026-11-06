import { test } from 'node:test';
import assert from 'node:assert/strict';
import { explainRunFailure, pullRequestsOff, usageNote, watchSummary, whereCodeGoes, whyNothingWaits } from '../src/shared/assistantText.ts';
import { storyResume, storySteps } from '../src/shared/plan.ts';
import type { ProjectScan, Step } from '../src/shared/types.ts';

const claude = { id: 'claude-code', name: 'Claude Code' };
const copilot = { id: 'copilot', name: 'GitHub Copilot' };
const gemini = { id: 'acp:gemini', name: 'Gemini' };

test('each assistant is honest about where the code goes and what a run uses', () => {
  assert.match(whereCodeGoes(claude), /Anthropic/);
  assert.match(whereCodeGoes(copilot), /GitHub/);
  assert.doesNotMatch(whereCodeGoes(copilot), /Anthropic/);
  assert.equal(whereCodeGoes(gemini), '', 'an agent we know nothing about gets no claim');
  assert.equal(usageNote(claude), 'It uses your Claude plan or API credit.');
  assert.match(usageNote(copilot), /premium requests/);
  assert.match(usageNote(gemini), /Gemini/);
});

test('a failed run says what to do next', () => {
  for (const why of ['Not logged in · Please run /login', 'Invalid API key · Please run /login', 'authentication_error', 'HTTP 401'])
    assert.match(explainRunFailure(claude, why), /Claude Code isn't signed in\. Run `claude` in a terminal/, why);
  assert.match(explainRunFailure(copilot, 'No authentication information found'), /GitHub Copilot isn't signed in\. Run `copilot`/);
  assert.match(explainRunFailure(gemini, 'unauthorized'), /Sign in to Gemini/);
  for (const why of ['Credit balance is too low', 'usage limit reached', 'rate_limit_error 429']) assert.match(explainRunFailure(claude, why), /run out of usage/, why);
  for (const why of ['API Error: 529 overloaded', 'getaddrinfo ENOTFOUND api.anthropic.com']) assert.match(explainRunFailure(claude, why), /couldn't reach its service/, why);
  assert.equal(explainRunFailure(claude, 'it took longer than 15 minutes'), 'Claude Code took longer than 15 minutes, so Hunkdory stopped it. Try again, or ask about a smaller part.');
  assert.equal(explainRunFailure(claude, 'exit code 3'), 'Claude Code stopped without an answer (exit code 3).');
});

const watch = (over = {}) => ({ anyBranch: true, pattern: null, pullRequests: false, ...over });

test('a project says what it shows, in words', () => {
  assert.equal(watchSummary({ watch: watch({ pullRequests: true }), github: 'me/repo' }), 'Local branches, pull requests on me/repo and uncommitted changes');
  assert.equal(watchSummary({ watch: watch(), github: null }), 'Local branches and uncommitted changes');
  assert.equal(watchSummary({ watch: watch({ anyBranch: false, pattern: 'claude/*' }), github: null }), 'Branches matching claude/* and uncommitted changes');
  assert.equal(watchSummary({ watch: watch({ anyBranch: false, pullRequests: true }), github: 'me/repo' }), 'Pull requests on me/repo and uncommitted changes');
});

test('pull requests are only offered where there can be some', () => {
  assert.equal(pullRequestsOff({ watch: watch(), remote: 'github.com/me/repo' }), true);
  assert.equal(pullRequestsOff({ watch: watch({ pullRequests: true }), remote: 'github.com/me/repo' }), false);
  assert.equal(pullRequestsOff({ watch: watch(), remote: 'gitlab.com/me/repo' }), false);
  assert.equal(pullRequestsOff({ watch: watch(), remote: null }), false);
});

test('an empty project says why, for what it actually looks at', () => {
  const scan = (over: Partial<ProjectScan> = {}): ProjectScan => ({ projectId: 'p', sessions: 0, branchesSeen: 0, gone: 0, upToDate: 0, waiting: 0, pullRequests: null, ...over });
  assert.equal(whyNothingWaits({ watch: watch(), github: null }, scan()), 'No local branches with changes.');
  assert.equal(whyNothingWaits({ watch: watch({ pullRequests: true }), github: 'me/r' }, scan({ pullRequests: 0 })), 'No local branches with changes. No open pull requests.');
  assert.equal(whyNothingWaits({ watch: watch({ anyBranch: false, pullRequests: true }), github: 'me/r' }, scan({ pullRequests: 2 })), '2 open pull requests, none could be read.');
  assert.equal(whyNothingWaits({ watch: watch(), github: null }, scan({ branchesSeen: 3, gone: 1, upToDate: 2 })), 'No local branches with changes. Agents worked on 3 branches, 1 no longer here, 2 with nothing left to review.');
  assert.equal(whyNothingWaits({ watch: watch({ anyBranch: false, pattern: 'claude/*' }), github: null }, scan()), 'No branches matching claude/* with changes.');
});

test('the story is every step in order, and picks up at the first one not read', () => {
  const step = (i: number, risk: Step['risk']): Step => ({ key: `k${i}`, index: i, title: `S${i}`, why: '', checks: [], risk, riskNote: null, outsideTask: false, noTestChange: false, choices: [], behaviour: null, dependents: [], source: 'chapter', hunkIds: [`h${i}`], files: ['a'], added: 1, removed: 0 });
  // The risky last step doesn't jump the queue, the way it does in "what needs you first".
  const data = { steps: [step(0, 'low'), step(1, 'low'), step(2, 'high')] };
  assert.deepEqual(storySteps(data).map((s) => s.key), ['k0', 'k1', 'k2']);
  assert.deepEqual(storyResume(data, { reviewed: {} }), { step: data.steps[0], at: 1, of: 3, started: false });
  const part = storyResume(data, { reviewed: { k0: ['h0'] } })!;
  assert.deepEqual([part.step.key, part.at, part.started], ['k1', 2, true]);
  assert.equal(storyResume(data, { reviewed: { k0: ['h0'], k1: ['h1'], k2: ['h2'] } }), null);
});
