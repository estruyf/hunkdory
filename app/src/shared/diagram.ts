// Where the boxes and arrows of a change diagram go: layers from top to bottom, callers above what they call. Pure.
import type { ChangeDiagram } from './types.ts';

export const BOX = { width: 228, height: 92, gapX: 56, gapY: 76 };
/** Room beside the boxes for an arrow that goes back up, or around a box in its way. */
const MARGIN = 44;
/** Labels closer together than this take turns on two heights, this far from the middle. */
const LABEL_WIDTH = 160;
const LABEL_STEP = 11;

export interface PlacedBox {
  id: string;
  x: number;
  y: number;
}

export interface PlacedArrow {
  from: string;
  to: string;
  label: string | null;
  /** An SVG path. */
  path: string;
  labelX: number;
  labelY: number;
}

export interface DiagramLayout {
  width: number;
  height: number;
  boxes: PlacedBox[];
  arrows: PlacedArrow[];
}

/** Arrows that close a loop. Layers need an order, so these don't count towards it. */
function loopEdges(d: Pick<ChangeDiagram, 'nodes' | 'edges'>): Set<number> {
  const loops = new Set<number>();
  const state = new Map<string, 'open' | 'done'>();
  const visit = (id: string) => {
    state.set(id, 'open');
    d.edges.forEach((e, i) => {
      if (e.from !== id) return;
      const next = state.get(e.to);
      if (next === 'open') loops.add(i);
      else if (!next) visit(e.to);
    });
    state.set(id, 'done');
  };
  for (const n of d.nodes) if (!state.has(n.id)) visit(n.id);
  return loops;
}

/** The row each box goes in: one below everything that calls it. */
function layers(d: Pick<ChangeDiagram, 'nodes' | 'edges'>, loops: Set<number>): Map<string, number> {
  const rank = new Map(d.nodes.map((n) => [n.id, 0]));
  for (let pass = 0; pass < d.nodes.length; pass++) {
    d.edges.forEach((e, i) => {
      if (!loops.has(i)) rank.set(e.to, Math.max(rank.get(e.to)!, rank.get(e.from)! + 1));
    });
  }
  return rank;
}

const curve = (x1: number, y1: number, x2: number, y2: number) => {
  const mid = (y1 + y2) / 2;
  return `C ${x1} ${mid}, ${x2} ${mid}, ${x2} ${y2}`;
};

export function layoutDiagram(d: Pick<ChangeDiagram, 'nodes' | 'edges'>): DiagramLayout {
  const loops = loopEdges(d);
  const rank = layers(d, loops);
  const rows: string[][] = [];
  for (const n of d.nodes) (rows[rank.get(n.id)!] ??= []).push(n.id);

  // Each row in the order of what calls it, so arrows cross less.
  const order = new Map<string, number>();
  rows.forEach((row, r) => {
    const pull = new Map(
      row.map((id, i) => {
        const above = d.edges.filter((e) => e.to === id && rank.get(e.from)! < r).map((e) => order.get(e.from)!);
        return [id, above.length ? above.reduce((a, b) => a + b, 0) / above.length : i];
      })
    );
    row.sort((a, b) => pull.get(a)! - pull.get(b)!);
    row.forEach((id, i) => order.set(id, i));
  });

  const rowWidth = (row: string[]) => row.length * BOX.width + (row.length - 1) * BOX.gapX;
  const inner = Math.max(...rows.map(rowWidth));
  const width = inner + MARGIN * 2;
  const rowY = (r: number) => r * (BOX.height + BOX.gapY);
  const height = rowY(rows.length - 1) + BOX.height;
  const place = new Map<string, PlacedBox>();
  rows.forEach((row, r) => {
    const left = MARGIN + (inner - rowWidth(row)) / 2;
    row.forEach((id, i) => place.set(id, { id, x: left + i * (BOX.width + BOX.gapX), y: rowY(r) }));
  });

  // Arrows share a box's edge evenly, in the order of where they go, so they don't start on top of each other.
  const forward = d.edges.map((_, i) => i).filter((i) => !loops.has(i));
  const spread = (i: number, side: 'from' | 'to') => {
    const other = side === 'from' ? 'to' : 'from';
    const box = place.get(d.edges[i][side])!;
    const peers = forward.filter((j) => d.edges[j][side] === d.edges[i][side]).sort((a, b) => place.get(d.edges[a][other])!.x - place.get(d.edges[b][other])!.x);
    return box.x + (BOX.width * (peers.indexOf(i) + 1)) / (peers.length + 1);
  };

  /** Where an arrow passes a row it doesn't stop at: the gap nearest its straight line. */
  const gapIn = (r: number, want: number) => {
    const row = rows[r].map((id) => place.get(id)!.x);
    const gaps = [row[0] - BOX.gapX / 2, ...row.map((x) => x + BOX.width + BOX.gapX / 2)];
    return gaps.reduce((best, x) => (Math.abs(x - want) < Math.abs(best - want) ? x : best));
  };

  const arrows: PlacedArrow[] = d.edges.map((e, i) => {
    const from = place.get(e.from)!;
    const to = place.get(e.to)!;
    if (loops.has(i)) {
      // Back up the right-hand side, outside the boxes.
      const [x1, y1, x2, y2] = [from.x + BOX.width, from.y + BOX.height / 2, to.x + BOX.width, to.y + BOX.height / 2];
      const out = Math.max(x1, x2) + MARGIN - 6;
      return { from: e.from, to: e.to, label: e.label, path: `M ${x1} ${y1} C ${out} ${y1}, ${out} ${y2}, ${x2} ${y2}`, labelX: out - 8, labelY: (y1 + y2) / 2 };
    }
    const [r1, r2] = [rank.get(e.from)!, rank.get(e.to)!];
    const [x1, y1, x2, y2] = [spread(i, 'from'), from.y + BOX.height, spread(i, 'to'), to.y];
    let path = `M ${x1} ${y1}`;
    let [x, y] = [x1, y1];
    for (let r = r1 + 1; r < r2; r++) {
      const pass = gapIn(r, x1 + ((x2 - x1) * (r - r1)) / (r2 - r1));
      path += ` ${curve(x, y, pass, rowY(r))} L ${pass} ${rowY(r) + BOX.height}`;
      [x, y] = [pass, rowY(r) + BOX.height];
    }
    path += ` ${curve(x, y, x2, y2)}`;
    return { from: e.from, to: e.to, label: e.label, path, labelX: (x + x2) / 2, labelY: (y + y2) / 2 };
  });

  // Labels in the same gap take turns on two heights around its middle when they'd touch, clear of the arrowheads below.
  const labelled = arrows.filter((a) => a.label).sort((a, b) => a.labelY - b.labelY || a.labelX - b.labelX);
  const middles = new Map(labelled.map((a) => [a, a.labelY]));
  labelled.forEach((a, i) => {
    const before = labelled[i - 1];
    const mid = middles.get(a)!;
    if (!before || middles.get(before) !== mid || a.labelX - before.labelX >= LABEL_WIDTH) return;
    if (before.labelY === mid) before.labelY = mid - LABEL_STEP;
    a.labelY = before.labelY < mid ? mid + LABEL_STEP : mid - LABEL_STEP;
  });

  return { width, height, boxes: [...place.values()], arrows };
}
