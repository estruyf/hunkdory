import { test } from 'node:test';
import assert from 'node:assert/strict';
import { answerLine, changeAfterQuestion, changeRequest, noteWasSent, setAnswerLine } from '../src/shared/comments.ts';
import type { ReviewState } from '../src/shared/types.ts';

const Q = '`validateLanguage` is copied from the page summary. Should it be shared instead?';
const stepComment = (r: Pick<ReviewState, 'comments'>) => r.comments.find((c) => c.stepKey === 's1' && !c.line)?.body;

test('an answer puts one line in the step comment, and a new answer replaces it', () => {
  const r: Pick<ReviewState, 'comments'> = { comments: [] };
  setAnswerLine(r, 's1', Q, answerLine(Q, 'unsure'));
  assert.equal(stepComment(r), `Not sure: ${Q}`);

  setAnswerLine(r, 's1', Q, answerLine(Q, 'no', 'Move it to\nutils/language.ts'));
  assert.equal(stepComment(r), `Needs a change: ${Q} — Move it to utils/language.ts`);

  // Editing the note replaces the line rather than adding another.
  setAnswerLine(r, 's1', Q, answerLine(Q, 'no', 'Share it with page summary'));
  assert.equal(stepComment(r), `Needs a change: ${Q} — Share it with page summary`);

  setAnswerLine(r, 's1', Q, answerLine(Q, 'yes'));
  assert.equal(r.comments.length, 0);
});

test('the rest of the step comment stays when an answer changes', () => {
  const r: Pick<ReviewState, 'comments'> = { comments: [] };
  setAnswerLine(r, 's1', Q, answerLine(Q, 'no'));
  r.comments[0].body = `Rename the handler.\n${r.comments[0].body}`;
  setAnswerLine(r, 's1', Q, null);
  assert.equal(stepComment(r), 'Rename the handler.');
});

test('a change request is the question and what should change, or just the question', () => {
  assert.equal(changeRequest('Is this fine?', '  Use better wording  '), 'Is this fine?\n\nUse better wording');
  assert.equal(changeRequest('Is this fine?', '   '), 'Is this fine?');
});

test('a note counts as sent while its run is going or done, not after it failed or was stopped', () => {
  const asked = (status: 'running' | 'done' | 'failed' | 'cancelled', kind: 'change' | 'question' = 'change') => [{ kind, status, text: changeRequest('Q?', 'Use better wording') }];
  assert.equal(noteWasSent('Q?', 'Use better wording', asked('running')), true);
  assert.equal(noteWasSent('Q?', 'Use better wording', asked('done')), true);
  assert.equal(noteWasSent('Q?', 'Use better wording', asked('failed')), false);
  assert.equal(noteWasSent('Q?', 'Use better wording', asked('cancelled')), false);
  assert.equal(noteWasSent('Q?', 'Use better wording', asked('done', 'question')), false, 'asking about it changes nothing');
  assert.equal(noteWasSent('Q?', 'Something else', asked('done')), false, 'a note you changed since is new');
  assert.equal(noteWasSent('Q?', '', asked('done')), false);
});

test('a change after a question uses what you typed, or the fix the answer described', () => {
  assert.equal(changeAfterQuestion('Q?', 'Guard the store', true), 'Q?\n\nGuard the store');
  assert.match(changeAfterQuestion('Q?', '  ', true), /^Q\?\n\nGo ahead and make the change you described/);
  assert.equal(changeAfterQuestion('Q?', '', false), 'Q?', 'no answer to point at');
});

test('a change sent after a question counts as sent, so the box stays empty under "Needs a change"', () => {
  const exchanges = [{ kind: 'change' as const, status: 'running' as const, text: changeAfterQuestion('Q?', 'Guard the store', true) }];
  assert.equal(noteWasSent('Q?', 'Guard the store', exchanges), true);
});
