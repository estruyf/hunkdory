import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BOX, layoutDiagram } from '../src/shared/diagram.ts';

const node = (id: string) => ({ id, label: id.toUpperCase(), kind: null, files: [`${id}.ts`], unchanged: false, stepKeys: [] });
const edge = (from: string, to: string, label: string | null = null) => ({ from, to, label });
const box = (l: ReturnType<typeof layoutDiagram>, id: string) => l.boxes.find((b) => b.id === id)!;

test('callers sit above what they call', () => {
  const l = layoutDiagram({ nodes: ['c', 'b', 'a'].map(node), edges: [edge('a', 'b'), edge('b', 'c')] });
  assert.ok(box(l, 'a').y < box(l, 'b').y);
  assert.ok(box(l, 'b').y < box(l, 'c').y);
});

test('no two boxes overlap, and every box fits inside the drawing', () => {
  const nodes = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map(node);
  const l = layoutDiagram({ nodes, edges: [edge('a', 'b'), edge('a', 'c'), edge('a', 'd'), edge('b', 'e'), edge('c', 'e'), edge('d', 'f'), edge('e', 'g'), edge('f', 'h')] });
  for (const p of l.boxes) {
    assert.ok(p.x >= 0 && p.x + BOX.width <= l.width);
    assert.ok(p.y >= 0 && p.y + BOX.height <= l.height);
    for (const q of l.boxes) {
      if (p === q) continue;
      const apart = p.x + BOX.width <= q.x || q.x + BOX.width <= p.x || p.y + BOX.height <= q.y || q.y + BOX.height <= p.y;
      assert.ok(apart, `${p.id} overlaps ${q.id}`);
    }
  }
});

test('a loop still gets a layout, with an arrow for every edge', () => {
  const edges = [edge('a', 'b'), edge('b', 'c'), edge('c', 'a')];
  const l = layoutDiagram({ nodes: ['a', 'b', 'c'].map(node), edges });
  assert.equal(l.arrows.length, 3);
  assert.ok(box(l, 'a').y < box(l, 'b').y);
  assert.ok(box(l, 'b').y < box(l, 'c').y);
  for (const a of l.arrows) assert.ok(!a.path.includes('NaN'));
});

test('an arrow that skips a row goes around the box in its way', () => {
  const l = layoutDiagram({ nodes: ['a', 'b', 'c'].map(node), edges: [edge('a', 'b'), edge('b', 'c'), edge('a', 'c')] });
  const skip = l.arrows.find((a) => a.from === 'a' && a.to === 'c')!;
  const middle = box(l, 'b');
  const [, x] = skip.path.match(/L (-?[\d.]+) /)!;
  assert.ok(+x < middle.x || +x > middle.x + BOX.width, 'it passes beside the middle box');
});

test('arrows from one box start apart, and labels in one gap do not sit on each other', () => {
  const l = layoutDiagram({ nodes: ['a', 'b', 'c'].map(node), edges: [edge('a', 'b', 'first label'), edge('a', 'c', 'second label')] });
  const starts = l.arrows.map((a) => a.path.split(' ')[1]);
  assert.notEqual(starts[0], starts[1]);
  const [p, q] = l.arrows;
  assert.ok(Math.abs(p.labelX - q.labelX) >= 100 || Math.abs(p.labelY - q.labelY) >= 20);
});
