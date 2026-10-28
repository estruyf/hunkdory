// Lines a review plan decision adds to a step comment, and takes away again. Pure, so it can be tested.
import type { ReviewState } from './types.ts';

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
