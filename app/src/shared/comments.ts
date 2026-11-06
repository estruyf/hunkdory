// Lines a review plan decision adds to a step comment, and takes away again. Pure, so it can be tested.
import type { Exchange, ReviewState } from './types.ts';

/** Appends a line to a step's comment, once. */
export function addToStepComment(r: Pick<ReviewState, 'comments'>, stepKey: string, line: string) {
  const text = line.trim();
  if (!text) return;
  const existing = r.comments.find((c) => c.stepKey === stepKey && !c.line);
  if (existing) {
    if (!existing.body.includes(text)) existing.body = `${existing.body.trim()}\n${text}`;
  } else r.comments.push({ id: crypto.randomUUID(), stepKey, hunkId: null, line: null, body: text, createdAt: new Date().toISOString() });
}

/** Takes a line out of every step comment, wherever it was added. A comment left empty is removed. */
export function removeFromStepComments(r: Pick<ReviewState, 'comments'>, line: string) {
  const text = line.trim();
  if (!text) return;
  for (const c of r.comments) {
    if (c.line || !c.body.includes(text)) continue;
    c.body = c.body
      .split('\n')
      .filter((l) => l.trim() !== text)
      .join('\n')
      .trim();
  }
  r.comments = r.comments.filter((c) => c.line || c.body);
}

const NOT_SURE = 'Not sure: ';
const NEEDS_CHANGE = 'Needs a change: ';

/** What a "Needs a change" asks the assistant for: the step's question, and what you said should change. */
export const changeRequest = (question: string, note: string) => (note.trim() ? `${question}\n\n${note.trim()}` : question).trim();

/** Asking for a change after a question: what you typed, or with nothing typed, the fix the answer described. Without an answer, just the question. */
export const changeAfterQuestion = (question: string, typed: string, answered: boolean) =>
  changeRequest(question, typed.trim() || (answered ? 'Go ahead and make the change you described in your answer to this.' : ''));

/** You already asked for this note, and that run didn't fail or get stopped: it stays on your review, but there's nothing left to send. */
export const noteWasSent = (question: string, note: string, exchanges: Pick<Exchange, 'kind' | 'status' | 'text'>[]) =>
  !!note.trim() && exchanges.some((e) => e.kind === 'change' && e.status !== 'failed' && e.status !== 'cancelled' && e.text === changeRequest(question, note));

/** The step comment's line for an answer to one of its questions: none for "Looks right". */
export function answerLine(question: string, value: 'yes' | 'no' | 'unsure' | null, note?: string): string | null {
  const q = question.trim();
  if (value === 'unsure') return `${NOT_SURE}${q}`;
  if (value !== 'no') return null;
  // One line, so the next answer can find it and take it out again.
  const n = note?.replace(/\s+/g, ' ').trim();
  return `${NEEDS_CHANGE}${q}${n ? ` — ${n}` : ''}`;
}

/** Replaces the line an earlier answer to `question` left in the step's comment with `line`, or just removes it. */
export function setAnswerLine(r: Pick<ReviewState, 'comments'>, stepKey: string, question: string, line: string | null) {
  const q = question.trim();
  const existing = r.comments.find((c) => c.stepKey === stepKey && !c.line);
  if (existing) {
    existing.body = existing.body
      .split('\n')
      .filter((l) => {
        const t = l.trim();
        return t !== `${NOT_SURE}${q}` && t !== `${NEEDS_CHANGE}${q}` && !t.startsWith(`${NEEDS_CHANGE}${q} — `);
      })
      .join('\n')
      .trim();
    if (!existing.body) r.comments = r.comments.filter((c) => c !== existing);
  }
  if (line) addToStepComment(r, stepKey, line);
}

/** What a GitHub review says when you post it without comments or a summary: GitHub wants some text on it. */
export const reviewedNote = (login: string | null) => `Reviewed${login ? ` by @${login}` : ''} in Hunkdory.`;
