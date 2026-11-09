// Checks a Windows installer before it is released (release.yml): every file in it can be unpacked, everything Hunkdory
// needs to run is there, and it holds one x64 and one Arm64 app. The installer's plugin (Nsis7z) skips a file compressed
// with a filter it can't read, without an error, so an installer can report success and leave no Hunkdory.exe, and the
// unpacked builds the other checks look at are still whole. So this reads the archives inside the finished installer.
// Usage: node scripts/checkWindowsInstaller.mjs [installer]   (after npm run dist, on Windows)
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { crc32 } from 'node:zlib';

/** What Nsis7z can read. A list of what is known to work, so a filter a later 7-Zip starts to pick fails the check too. */
const READABLE_METHODS = new Set(['Copy', 'LZMA', 'LZMA2', 'BCJ', 'BCJ2']);
const SIGNATURE = Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]);
/** The installer holds one package per architecture (electron-builder.yml, win.target). */
const PACKAGES = 2;
/** What every package needs besides wtv: the app, its code, where it looks for updates, and Chromium's English locale. */
const NEEDED = ['Hunkdory.exe', 'resources/app.asar', 'resources/app-update.yml', 'locales/en-US.pak'];
/** The architecture a Windows program is built for, by the machine type in its PE header. */
const MACHINES = { 0x8664: 'x64', 0xaa64: 'arm64' };

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

/**
 * What would be missing after an install from this package, as a sentence for each problem: a file the installer can't
 * unpack, or one of `needed` (paths with `/`) that isn't there. 7-Zip lists paths with `\` on Windows.
 */
export function packageProblems(files, needed = ['Hunkdory.exe']) {
  const problems = files
    .filter(({ method }) => method.split(' ').some((part) => part && !READABLE_METHODS.has(part.split(':')[0])))
    .map(({ path, method }) => `${path} is compressed with ${method}, which the installer can't unpack.`);
  const there = new Set(files.map(({ path }) => path.replaceAll('\\', '/')));
  for (const path of needed) if (!there.has(path)) problems.push(`There is no ${path}.`);
  return problems;
}

/** The architecture of a Windows program (x64 or arm64), from its PE header; null when it isn't one or is another. */
export function exeArchitecture(data) {
  if (data.length < 64 || data.toString('latin1', 0, 2) !== 'MZ') return null;
  const pe = data.readUInt32LE(0x3c);
  if (pe + 6 > data.length || data.toString('latin1', pe, pe + 4) !== 'PE\0\0') return null;
  return MACHINES[data.readUInt16LE(pe + 4)] ?? null;
}

/** The files of tools/wtv the app ships (electron-builder.yml → extraResources), as they sit in a package. */
function wtvFiles() {
  const wtv = join(import.meta.dirname, '..', '..', 'tools', 'wtv');
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
  return [...walk(join(wtv, 'bin')), ...walk(join(wtv, 'src')), join(wtv, 'package.json')].map((file) => `resources/tools/wtv/${relative(wtv, file).replaceAll('\\', '/')}`);
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

  const needed = [...NEEDED, ...wtvFiles()];
  const dir = mkdtempSync(join(tmpdir(), 'hunkdory-installer-'));
  let bad = false;
  const architectures = [];
  try {
    archives.forEach(({ start, end }, index) => {
      const file = join(dir, `package-${index}.7z`);
      writeFileSync(file, data.subarray(start, end));
      const files = listedFiles(execFileSync(sevenZip, ['l', '-slt', file], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
      const problems = packageProblems(files, needed);
      if (!problems.length) {
        // The app itself, unpacked, says which PC it's for.
        execFileSync(sevenZip, ['e', '-y', `-o${join(dir, String(index))}`, file, 'Hunkdory.exe'], { stdio: 'ignore' });
        architectures.push(exeArchitecture(readFileSync(join(dir, String(index), 'Hunkdory.exe'))));
      }
      console.log(`Package ${index + 1} of ${PACKAGES}: ${files.length} entries, ${problems.length} problems${architectures[index] ? `, ${architectures[index]}` : ''}.`);
      for (const problem of problems) console.log(`::error::Package ${index + 1}: ${problem}`);
      bad ||= problems.length > 0;
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  if (bad) process.exit(1);
  if ([...architectures].sort().join(' ') !== 'arm64 x64') fail(`Expected an x64 and an Arm64 app, found: ${architectures.map((a) => a ?? 'neither').join(' and ')}.`);
  console.log(`Both packages unpack every file, and have all ${needed.length} files Hunkdory needs: one for x64, one for Arm64.`);
}

// Run as a script; imported (to check the helpers), it only defines.
if (process.argv[1]?.endsWith('checkWindowsInstaller.mjs')) await main();
