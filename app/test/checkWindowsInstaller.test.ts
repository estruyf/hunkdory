import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crc32 } from 'node:zlib';
import { embeddedArchives, exeArchitecture, listedFiles, packageProblems } from '../scripts/checkWindowsInstaller.mjs';

// The release workflow's check of the Windows installer (scripts/checkWindowsInstaller.mjs), as Seshboard checks its own.

/** The start of a .7z archive with this much after its 32-byte header, with a checksum that is right or not. */
function archive(bodySize: number, validChecksum = true): Buffer {
  const out = Buffer.alloc(32 + bodySize);
  Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]).copy(out);
  out.writeBigUInt64LE(BigInt(bodySize - 4), 12);
  out.writeBigUInt64LE(4n, 20);
  out.writeUInt32LE(validChecksum ? crc32(out.subarray(12, 32)) : 0, 8);
  return out;
}

const LISTING = [
  'Listing archive: package.7z',
  '',
  '--',
  'Path = package.7z',
  'Type = 7z',
  'Method = 0A LZMA2:20 LZMA:20 BCJ2',
  '',
  '----------',
  'Path = locales',
  'Folder = +',
  'Method = ',
  '',
  'Path = Hunkdory.exe',
  'Size = 10',
  'Method = BCJ2 LZMA2:20 LZMA:20:lc0:lp2 LZMA:20:lc0:lp2',
  '',
  'Path = ffmpeg.dll',
  'Method = 0A LZMA2:20',
  '',
].join('\r\n');

/** The first bytes of a Windows program built for this machine type. */
function exe(machine: number): Buffer {
  const out = Buffer.alloc(0x100);
  out.write('MZ', 0, 'latin1');
  out.writeUInt32LE(0x80, 0x3c);
  out.write('PE\0\0', 0x80, 'latin1');
  out.writeUInt16LE(machine, 0x84);
  return out;
}

test('the archives in an installer are found between other bytes, and look-alikes are skipped', () => {
  const pad = Buffer.alloc(10, 1);
  assert.deepEqual(embeddedArchives(Buffer.concat([pad, archive(20), pad, archive(8), pad])), [{ start: 10, end: 62 }, { start: 72, end: 112 }]);
  assert.deepEqual(embeddedArchives(archive(20, false)), []);
  assert.deepEqual(embeddedArchives(archive(20).subarray(0, 40)), []);
  assert.deepEqual(embeddedArchives(archive(20).subarray(0, 16)), []);
});

test("a package's listing is its files, not the archive itself", () => {
  assert.deepEqual(listedFiles(LISTING), [
    { path: 'locales', method: '' },
    { path: 'Hunkdory.exe', method: 'BCJ2 LZMA2:20 LZMA:20:lc0:lp2 LZMA:20:lc0:lp2' },
    { path: 'ffmpeg.dll', method: '0A LZMA2:20' },
  ]);
});

test('a package passes when the installer can unpack every file', () => {
  const app = { path: 'Hunkdory.exe', method: 'BCJ LZMA2:26' };
  assert.deepEqual(packageProblems([app, { path: 'locales', method: '' }, { path: 'icudtl.dat', method: 'LZMA2:26' }, { path: 'a.dll', method: 'BCJ2 LZMA2:26 LZMA:20:lc0:lp2 LZMA:20:lc0:lp2' }]), []);
  const problems = packageProblems([app, { path: 'a.dll', method: 'ARM64 LZMA2:26' }, { path: 'b.dll', method: '0A LZMA2:20' }, { path: 'c.dll', method: 'RISCV LZMA2:26' }]);
  assert.equal(problems.length, 3, 'the ARM64 filter, by name or by number, and any filter it does not know');
  assert.match(problems[0]!, /a\.dll/);
});

test('a package without a file Hunkdory needs fails, however 7-Zip writes its paths', () => {
  assert.deepEqual(packageProblems([{ path: 'icudtl.dat', method: 'LZMA2:26' }]), ['There is no Hunkdory.exe.']);
  const needed = ['Hunkdory.exe', 'resources/app.asar', 'resources/tools/wtv/bin/wtv.mjs'];
  const files = ['Hunkdory.exe', 'resources\\app.asar', 'resources\\tools\\wtv\\bin\\wtv.mjs'].map((path) => ({ path, method: 'LZMA2:26' }));
  assert.deepEqual(packageProblems(files, needed), [], 'Windows lists them with \\');
  assert.deepEqual(packageProblems(files.slice(0, 2), needed), ['There is no resources/tools/wtv/bin/wtv.mjs.']);
});

test("a program's architecture comes from its PE header", () => {
  assert.equal(exeArchitecture(exe(0x8664)), 'x64');
  assert.equal(exeArchitecture(exe(0xaa64)), 'arm64');
  assert.equal(exeArchitecture(exe(0x14c)), null, '32-bit x86 is neither');
  assert.equal(exeArchitecture(Buffer.from('not a program')), null);
});
