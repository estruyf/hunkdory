// Checks a Windows installer before it is released (release.yml): every file in it can be unpacked. The installer's
// plugin (Nsis7z) skips a file compressed with a filter it can't read, without an error, so an installer can report
// success and leave no Hunkdory.exe, and the unpacked builds the other checks look at are still whole. So this reads
// the archives inside the finished installer.
// Usage: node scripts/checkWindowsInstaller.mjs [installer]   (after npm run dist, on Windows)
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32 } from 'node:zlib';

/** What Nsis7z can read. A list of what is known to work, so a filter a later 7-Zip starts to pick fails the check too. */
const READABLE_METHODS = new Set(['Copy', 'LZMA', 'LZMA2', 'BCJ', 'BCJ2']);
const SIGNATURE = Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]);
/** The installer holds one package per architecture (electron-builder.yml, win.target). */
const PACKAGES = 2;

/** Where the .7z archives stored in an installer are. A start header's checksum tells an archive from bytes that look like one. */
export function embeddedArchives(data) {
  const found = [];
  let at = 0;
  while ((at = data.indexOf(SIGNATURE, at)) !== -1) {
    const header = data.subarray(at + 12, at + 32);
    const end = header.length === 20 && crc32(header) === data.readUInt32LE(at + 8) ? at + 32 + Number(header.readBigUInt64LE(0) + header.readBigUInt64LE(8)) : Infinity;
    if (end <= data.length) {
      found.push({ start: at, end });
      at = end;
    } else {
      at += SIGNATURE.length;
    }
  }
  return found;
}

/** The files in a `7za l -slt` listing, with the compression method of each ('' for a folder). */
export function listedFiles(listing) {
  // Before the first row of dashes is the archive itself, which has a Path and a Method too.
  const entries = listing.split(/^-{10,}\s*$/m).slice(1).join('\n');
  return entries.split(/\r?\n\s*\r?\n/).flatMap((block) => {
    const path = /^Path = (.*?)\s*$/m.exec(block)?.[1];
    return path ? [{ path, method: /^Method = (.*?)\s*$/m.exec(block)?.[1] ?? '' }] : [];
  });
}

/** What would be missing after an install from this package, as a sentence for each problem. */
export function packageProblems(files) {
  const problems = files
    .filter(({ method }) => method.split(' ').some((part) => part && !READABLE_METHODS.has(part.split(':')[0])))
    .map(({ path, method }) => `${path} is compressed with ${method}, which the installer can't unpack.`);
  if (!files.some(({ path }) => path === 'Hunkdory.exe')) problems.push('There is no Hunkdory.exe.');
  return problems;
}

async function main() {
  const fail = (message) => {
    console.log(`::error::${message}`);
    process.exit(1);
  };
  const dist = join(import.meta.dirname, '..', 'dist');
  const installers = process.argv[2] ? [process.argv[2]] : readdirSync(dist).filter((name) => /^Hunkdory-.+-setup\.exe$/.test(name)).map((name) => join(dist, name));
  if (installers.length !== 1) fail(`Expected one installer in ${dist}, found: ${installers.join(', ') || 'nothing'}`);

  const data = readFileSync(installers[0]);
  const archives = embeddedArchives(data);
  if (archives.length !== PACKAGES) fail(`Expected ${PACKAGES} packages in ${installers[0]}, found ${archives.length}.`);

  // electron-builder's own 7-Zip, the one that made the archives: an older one lists a filter it doesn't know by number.
  const builderRequire = createRequire(createRequire(import.meta.url).resolve('electron-builder/package.json'));
  const { getPath7za } = createRequire(builderRequire.resolve('app-builder-lib/package.json'))('./out/toolsets/7zip.js');
  const sevenZip = await getPath7za();

  const dir = mkdtempSync(join(tmpdir(), 'hunkdory-installer-'));
  let bad = false;
  try {
    archives.forEach(({ start, end }, index) => {
      const file = join(dir, `package-${index}.7z`);
      writeFileSync(file, data.subarray(start, end));
      const files = listedFiles(execFileSync(sevenZip, ['l', '-slt', file], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
      const problems = packageProblems(files);
      console.log(`Package ${index + 1} of ${PACKAGES}: ${files.length} entries, ${problems.length} problems.`);
      for (const problem of problems) console.log(`::error::Package ${index + 1}: ${problem}`);
      bad ||= problems.length > 0;
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  if (bad) process.exit(1);
  console.log('The installer can unpack every file in both packages.');
}

// Run as a script; imported (to check the helpers), it only defines.
if (process.argv[1]?.endsWith('checkWindowsInstaller.mjs')) await main();
