import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { MAX_ICON_BYTES, detectIconPath, detectedIcon, fitIcon, forgetIconFile, iconDataUrl, previewIconFile, projectIconInfo, storeIconChoice, useIconFolder } from '../src/main/projectIcons.ts';
import { decodePng, encodePng } from '../src/main/pngShrink.ts';

const base = realpathSync(mkdtempSync(join(tmpdir(), 'hunkdory-icons-')));
after(() => rmSync(base, { recursive: true, force: true }));
useIconFolder(join(base, 'kept'));

let n = 0;
const repo = () => {
  const root = join(base, `repo-${n++}`);
  mkdirSync(root);
  return root;
};
const put = (root: string, file: string, content: string | Buffer = '<svg xmlns="http://www.w3.org/2000/svg"/>') => {
  const path = join(root, file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  return path;
};
/** A real PNG, large enough on disk that it has to be scaled: random pixels don't compress. */
function bigPng(side = 400) {
  return encodePng({ width: side, height: side, data: new Uint8Array(randomBytes(side * side * 4)) });
}

test('nothing to find: no icon, and the project shows its letter', () => {
  const root = repo();
  assert.equal(detectIconPath(root), null);
  assert.deepEqual(detectedIcon(root), { icon: null, source: null, path: null });
});

test('the best icon wins: declared, then by convention, vector before bitmap, the root before its packages', () => {
  const root = repo();
  put(root, 'apps/web/public/favicon.svg');
  assert.equal(detectIconPath(root), join(root, 'apps/web/public/favicon.svg'), 'a monorepo package');
  put(root, 'public/favicon.ico', 'ico');
  assert.equal(detectIconPath(root), join(root, 'public/favicon.ico'), 'the root over a package');
  put(root, 'public/favicon.svg');
  assert.equal(detectIconPath(root), join(root, 'public/favicon.svg'), 'vector over bitmap');
  put(root, 'media/brand.png', 'png');
  put(root, 'package.json', JSON.stringify({ icon: 'media/brand.png' }));
  assert.equal(detectIconPath(root), join(root, 'media/brand.png'), 'what the package declares');
  put(root, 'other/mine.svg');
  put(root, '.hunkdory.json', JSON.stringify({ iconPath: 'other/mine.svg' }));
  assert.equal(detectIconPath(root), join(root, 'other/mine.svg'), "Hunkdory's own setting first");
});

test('an app in a subfolder counts, as Hunkdory has itself', () => {
  const root = repo();
  put(root, 'app/resources/icon.png', 'png');
  assert.deepEqual(detectedIcon(root).path, join('app', 'resources', 'icon.png'));
});

test('a repo cannot point its icon outside itself, by path or by link', () => {
  const root = repo();
  const secret = put(base, 'secret.svg');
  put(root, '.hunkdory.json', JSON.stringify({ iconPath: '../secret.svg' }));
  assert.equal(detectIconPath(root), null, 'up and out');
  put(root, '.hunkdory.json', JSON.stringify({ iconPath: secret }));
  assert.equal(detectIconPath(root), null, 'an absolute path is joined inside the repo');
  put(root, '.hunkdory.json', JSON.stringify({ iconPath: 'https://example.com/a.svg' }));
  assert.equal(detectIconPath(root), null, 'not over the network');
  rmSync(join(root, '.hunkdory.json'));
  symlinkSync(secret, join(root, 'icon.svg'));
  assert.equal(detectIconPath(root), null, 'a link out of the repo');
});

test('a settings file that is a link is not read', () => {
  const root = repo();
  const outside = put(base, 'outside.json', JSON.stringify({ iconPath: 'real.svg' }));
  put(root, 'real.svg');
  symlinkSync(outside, join(root, '.hunkdory.json'));
  assert.equal(detectIconPath(root), null);
});

test('things that are no use as an icon are passed over', () => {
  const root = repo();
  put(root, 'favicon.svg', '');
  put(root, 'icon.svg', 'x'.repeat(MAX_ICON_BYTES + 1));
  mkdirSync(join(root, 'logo.svg'));
  put(root, 'package.json', '{ not json');
  assert.equal(detectIconPath(root), null);
  put(root, '.hunkdory.json', JSON.stringify({ iconPath: 'notes.txt' }));
  put(root, 'notes.txt', 'hello');
  assert.equal(detectIconPath(root), null, 'not an image type');
});

test('a large PNG is scaled down, and other large images are turned away', () => {
  const big = bigPng();
  assert.ok(big.length > MAX_ICON_BYTES, 'the test image really is large');
  const small = fitIcon('.png', big)!;
  assert.ok(small.length <= MAX_ICON_BYTES);
  assert.equal(decodePng(small)!.width, 128);
  assert.equal(fitIcon('.jpg', big), null);
  assert.equal(fitIcon('.txt', Buffer.from('x')), null);
  assert.equal(fitIcon('.png', Buffer.alloc(0)), null);
  const garbage = Buffer.alloc(MAX_ICON_BYTES + 1, 7);
  assert.equal(fitIcon('.png', garbage), null, 'large, and not really a PNG');
  // A PNG that says it's enormous is refused before its pixels are inflated.
  const header = Buffer.alloc(13);
  header.writeUInt32BE(100_000, 0);
  header.writeUInt32BE(100_000, 4);
  header[8] = 8;
  header[9] = 6;
  const huge = encodePng({ width: 1, height: 1, data: new Uint8Array(4) });
  header.copy(huge, 16);
  assert.equal(decodePng(huge), null);
});

test('an icon goes to the window as a data URL of the right type', () => {
  const root = repo();
  const svg = iconDataUrl(put(root, 'a.svg'));
  assert.equal(svg?.kind, 'image');
  assert.match((svg as { dataUrl: string }).dataUrl, /^data:image\/svg\+xml;base64,/);
  assert.match((iconDataUrl(put(root, 'b.ICO', 'x')) as { dataUrl: string }).dataUrl, /^data:image\/x-icon;/);
});

test('what you picked wins over what the repo has, and auto goes back', () => {
  const root = repo();
  put(root, 'favicon.svg');
  assert.equal(projectIconInfo({ path: root }).source, 'detected');
  assert.deepEqual(projectIconInfo({ path: root, icon: { kind: 'emoji', value: '🚀' } }), { icon: { kind: 'emoji', value: '🚀' }, source: 'custom', path: null });
  assert.deepEqual(projectIconInfo({ path: root, icon: { kind: 'none' } }), { icon: null, source: 'custom', path: null }, 'the letter, on purpose');
  assert.equal(storeIconChoice('p', { kind: 'auto' }), undefined);
});

test('a picked image is copied in, so it outlasts the original, and cleaned up when replaced', () => {
  const root = repo();
  const original = put(root, 'mine.png', bigPng());
  const stored = storeIconChoice('project-1', { kind: 'file', path: original })!;
  assert.equal(stored.kind, 'file');
  const copy = (stored as { path: string }).path;
  assert.ok(statSync(copy).size <= MAX_ICON_BYTES, 'scaled down');
  rmSync(original);
  assert.equal(projectIconInfo({ path: root, icon: stored }).source, 'custom', 'the original is gone');
  forgetIconFile(stored, stored);
  assert.ok(existsSync(copy), 'the same file is still in use');
  forgetIconFile(stored, { kind: 'emoji', value: '🚀' });
  assert.equal(existsSync(copy), false);
  assert.equal(projectIconInfo({ path: root, icon: stored }).source, null, 'its copy gone and nothing in the repo: the letter');
});

test('an image that cannot be an icon says why, and keeps nothing', () => {
  const root = repo();
  assert.throws(() => previewIconFile(put(root, 'notes.txt', 'x')), /Use an SVG, PNG/);
  assert.throws(() => previewIconFile(join(root, 'missing.png')), /Not a file/);
  assert.throws(() => previewIconFile(put(root, 'big.jpg', Buffer.alloc(MAX_ICON_BYTES + 1, 1))), /200 KB/);
  assert.throws(() => previewIconFile(put(root, 'fake.png', Buffer.alloc(MAX_ICON_BYTES + 1, 1))), /can't be used/);
  assert.throws(() => storeIconChoice('p2', { kind: 'file', path: join(root, 'fake.png') }), /can't be used/);
  assert.equal(existsSync(join(base, 'kept', 'p2.png')), false);
});
