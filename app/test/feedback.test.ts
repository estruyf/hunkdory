import { test } from 'node:test';
import assert from 'node:assert/strict';
import { feedbackUrl } from '../src/shared/feedback.ts';

test('feedback opens a GitHub issue with the version filled in, and works before the version is known', () => {
  const url = feedbackUrl({ version: '1.2.3', electron: '45', chrome: '140', node: '24', os: 'macOS 27.0 (arm64)' });
  assert.ok(url.startsWith('https://github.com/estruyf/hunkdory/issues/new?body='), 'https, or the app refuses to open it');
  const body = new URL(url).searchParams.get('body')!;
  assert.match(body, /Hunkdory 1\.2\.3/);
  assert.match(body, /macOS 27\.0 \(arm64\)/);
  assert.equal(feedbackUrl(null), 'https://github.com/estruyf/hunkdory/issues/new');
});
