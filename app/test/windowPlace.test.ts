import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/main/store.ts';
import { restoredBounds } from '../src/main/windowPlace.ts';

const laptop = { x: 0, y: 25, width: 1512, height: 900 };
const external = { x: 1512, y: -200, width: 2560, height: 1415 };

test('the window opens where you left it', () => {
  const saved = { x: 100, y: 80, width: 1200, height: 800 };
  assert.deepEqual(restoredBounds(saved, [laptop, external], laptop), saved);
});

test('it stays on a second screen, also left of or above the primary one', () => {
  const saved = { x: 1700, y: -100, width: 1600, height: 1000 };
  assert.deepEqual(restoredBounds(saved, [laptop, external], laptop), saved);
  const left = { x: -2000, y: 25, width: 2000, height: 1100 };
  const there = { x: -1800, y: 100, width: 1200, height: 800 };
  assert.deepEqual(restoredBounds(there, [laptop, left], laptop), there);
});

test('a window across two screens stays there', () => {
  const saved = { x: 1200, y: 100, width: 1000, height: 700 };
  assert.deepEqual(restoredBounds(saved, [laptop, external], laptop), saved);
});

test('a screen that is gone puts the window back on the primary one, centred and fitting', () => {
  assert.deepEqual(restoredBounds({ x: 1700, y: -100, width: 2200, height: 1200 }, [laptop], laptop), { width: 1512, height: 900 });
  assert.deepEqual(restoredBounds({ x: 1700, y: -100, width: 1200, height: 800 }, [laptop], laptop), { width: 1200, height: 800 });
});

test('a top bar you can no longer reach counts as gone', () => {
  // Above the screen, below it, and only a sliver left at the side.
  for (const place of [
    { x: 100, y: -300, width: 1200, height: 800 },
    { x: 100, y: 900, width: 1200, height: 800 },
    { x: 1450, y: 100, width: 1200, height: 800 },
  ]) {
    assert.deepEqual(restoredBounds(place, [laptop], laptop), { width: 1200, height: 800 });
  }
});

test('a window too big for the screen it is on shrinks to fit, from the corner', () => {
  assert.deepEqual(restoredBounds({ x: 100, y: 80, width: 2400, height: 1300 }, [laptop], laptop), { x: 0, y: 25, width: 1512, height: 900 });
  // Only the height no longer fits: it keeps its x.
  assert.deepEqual(restoredBounds({ x: 100, y: 80, width: 1200, height: 1300 }, [laptop], laptop), { x: 100, y: 25, width: 1200, height: 900 });
});

test('the store keeps the place across restarts', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'window-place-')), 'store.json');
  const store = new Store(file);
  assert.equal(store.windowPlace(), null);
  const place = { x: 100, y: 80, width: 1200, height: 800, maximized: true };
  store.setWindowPlace(place);
  assert.deepEqual(new Store(file).windowPlace(), place);
});
