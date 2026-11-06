import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promptPreview, shortUrl } from '../src/shared/promptText.ts';

test('a long link reads as its host and the parts of the path that say something', () => {
  assert.equal(shortUrl('https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/api/ai-services/search/overview'), 'learn.microsoft.com › microsoft-365 › search › overview');
  assert.equal(shortUrl('https://www.example.com/docs/some-long-section/a-very-long-page-name-here?x=1#top'), 'example.com › docs › some-long-section › a-very-long-page-name-here');
});

test('a short link stays as it is', () => {
  assert.equal(shortUrl('https://github.com/estruyf/hunkdory'), 'https://github.com/estruyf/hunkdory');
});

test('ids and hashes in a link are left out, and only web links are touched', () => {
  assert.equal(shortUrl('https://example.com/runs/0123456789abcdef0123456789abcdef/report/final'), 'example.com › runs › report › final');
  const other = `ftp://example.com/${'a'.repeat(60)}`;
  assert.equal(shortUrl(other), other);
});

test('a short prompt is shown whole, with its link as a part', () => {
  const url = 'https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/api/ai-services/search/overview';
  const { parts, cut } = promptPreview(`See ${url}. Thanks`, 240);
  assert.equal(cut, false);
  assert.deepEqual(parts, [{ text: 'See ' }, { url, label: 'learn.microsoft.com › microsoft-365 › search › overview' }, { text: '. Thanks' }]);
});

test('a long link counts as what it shows, so it does not use up the preview', () => {
  const url = `https://example.com/docs/${'long-section/'.repeat(12)}page`;
  assert.equal(promptPreview(`${url} short text`, 60).cut, false);
});

test('a long prompt ends on a whole word, with the rest behind Show all', () => {
  const { parts, cut } = promptPreview('one two three four five', 10);
  assert.equal(cut, true);
  assert.deepEqual(parts, [{ text: 'one two…' }]);
});

test('a link that does not fit is left out, not cut in half', () => {
  const url = `https://example.com/docs/${'x-section/'.repeat(10)}page`;
  const { parts, cut } = promptPreview(`Look at ${url} please`, 12);
  assert.equal(cut, true);
  assert.deepEqual(parts, [{ text: 'Look at…' }]);
});

test('markdown marks are gone from the preview, and a link in markdown is still a link', () => {
  const { parts } = promptPreview('## Summary\n- **Fix** the `login`\n\n[docs](https://example.com/a)', 240);
  assert.deepEqual(parts, [{ text: 'Summary\nFix the login\n' }, { url: 'https://example.com/a', label: 'https://example.com/a' }]);
});
