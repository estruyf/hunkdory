import { test } from 'node:test';
import assert from 'node:assert/strict';
import { claudeArgs, ISOLATED, READ_GIT } from '../src/main/assistants/claude.ts';

// Snapshots of Claude Code's argument list per mode, so moving the argument building into the Assistant
// interface (slice 1 of docs/plans/2026-11-02-assistants.md) didn't change what Claude Code is asked to do.

test('a git-only run (walkthrough on a branch read through refs, or a question without a checkout)', () => {
  assert.deepEqual(claudeArgs({ prompt: 'p', access: 'git-only', session: null }), ['--print', 'p', '--tools', 'Bash', '--allowedTools', ...READ_GIT, ...ISOLATED]);
});

test('a read run adds Read, Grep and Glob to a git-only one', () => {
  assert.deepEqual(claudeArgs({ prompt: 'p', access: 'read', session: null }), ['--print', 'p', '--tools', 'Bash', 'Read', 'Grep', 'Glob', '--allowedTools', ...READ_GIT, 'Read', 'Grep', 'Glob', ...ISOLATED]);
});

test('a run with a schema asks for structured output, before the tools', () => {
  assert.deepEqual(claudeArgs({ prompt: 'p', access: 'read', session: null, schema: { type: 'object' } }), [
    '--print', 'p', '--json-schema', '{"type":"object"}', '--tools', 'Bash', 'Read', 'Grep', 'Glob', '--allowedTools', ...READ_GIT, 'Read', 'Grep', 'Glob', ...ISOLATED,
  ]);
});

test('an edit run accepts edits, adds Edit and Write, but keeps Bash to read-only git', () => {
  assert.deepEqual(claudeArgs({ prompt: 'p', access: 'edit', session: null }), [
    '--print', 'p', '--permission-mode', 'acceptEdits', '--tools', 'Bash', 'Read', 'Grep', 'Glob', 'Edit', 'Write', '--allowedTools', ...READ_GIT, ...ISOLATED,
  ]);
});

test('a copied session is forked and not persisted, read-only, regardless of access', () => {
  const expected = ['--resume', 's1', '--fork-session', '--no-session-persistence', '--print', 'p', '--tools', 'Bash', 'Read', 'Grep', 'Glob', '--allowedTools', ...READ_GIT, 'Read', 'Grep', 'Glob'];
  assert.deepEqual(claudeArgs({ prompt: 'p', access: 'read', session: { id: 's1', mode: 'copy' } }), expected);
  assert.deepEqual(claudeArgs({ prompt: 'p', access: 'git-only', session: { id: 's1', mode: 'copy' } }), expected);
});

test('a continued session resumes in place, allowed only the given bash commands and read-only git, not Hunkdory\'s isolation flags', () => {
  assert.deepEqual(claudeArgs({ prompt: 'p', access: 'edit', session: { id: 's1', mode: 'continue' }, allowBash: ['Bash(wtv *)'] }), [
    '--resume', 's1', '--print', 'p', '--permission-mode', 'acceptEdits', '--allowedTools', 'Bash(wtv *)', ...READ_GIT,
  ]);
});
