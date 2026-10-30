import { test } from 'node:test';
import assert from 'node:assert/strict';
import { answerLine, setAnswerLine } from '../src/shared/comments.ts';
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
