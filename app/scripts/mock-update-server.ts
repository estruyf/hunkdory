/**
 * A local update feed for testing Hunkdory's updater without publishing anything.
 *
 *   node scripts/mock-update-server.ts --dir dist        # serve a real build (latest-mac.yml + .zip)
 *   node scripts/mock-update-server.ts --fake 9.9.9      # serve a made-up feed offering 9.9.9
 *
 * Then start Hunkdory with HUNKDORY_MOCK_UPDATES_URL=http://localhost:8484. A fake feed is enough to see a check find
 * an update and its release notes; the download then fails, since there is no build behind it. See docs/development.md.
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    dir: { type: 'string' },
    fake: { type: 'string' },
    port: { type: 'string', default: '8484' },
  },
});
const port = Number(values.port);
const dir = values.dir ? resolve(values.dir) : null;
if (!dir && !values.fake) {
  console.error('Pass --dir <folder with latest-mac.yml> or --fake <version>.');
  process.exit(1);
}

function fakeFeed(version: string): string {
  const file = `Hunkdory-${version}-arm64-mac.zip`;
  const sha512 = Buffer.alloc(64).toString('base64');
  return [
    `version: ${version}`,
    'files:',
    `  - url: ${file}`,
    `    sha512: ${sha512}`,
    '    size: 1024',
    `path: ${file}`,
    `sha512: ${sha512}`,
    `releaseDate: '${new Date().toISOString()}'`,
    'releaseNotes: |',
    '  ### Updates',
    '',
    '  - A made-up release from the mock update server.',
    '  - A fake feed has no build behind it, so downloading fails.',
    '',
  ].join('\n');
}

const fake = values.fake ? fakeFeed(values.fake) : null;

/** The file `path` names inside `dir`, or null if it points anywhere else (`..`, an encoded `/`, a sibling folder). */
function fileIn(dir: string, path: string): string | null {
  const file = resolve(dir, path);
  return file === dir || file.startsWith(dir + sep) ? file : null;
}

createServer((request, response) => {
  let path: string;
  try {
    // Decoded before resolving, so %2e%2e and %2f are checked like the characters they stand for.
    path = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname).replace(/^\/+/, '');
  } catch {
    response.writeHead(400).end('Bad request');
    return;
  }
  console.log(`${request.method} /${path}`);
  if (fake && path === 'latest-mac.yml') {
    response.writeHead(200, { 'content-type': 'text/yaml' });
    response.end(fake);
    return;
  }
  const file = dir ? fileIn(dir, path) : null;
  if (!file || !existsSync(file) || !statSync(file).isFile()) {
    response.writeHead(404).end('Not found');
    return;
  }
  response.writeHead(200, { 'content-length': statSync(file).size });
  createReadStream(file).pipe(response);
}).listen(port, '127.0.0.1', () => {
  console.log(`Mock update feed on http://localhost:${port} (${fake ? `offering ${values.fake}` : dir})`);
  console.log(`Start Hunkdory with HUNKDORY_MOCK_UPDATES_URL=http://localhost:${port}`);
});
