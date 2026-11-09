// Checks a Windows build before it is released (release.yml): the installer and both apps carry a valid signature,
// and their signer is the publisher the app will check updates against. electron-updater installs an update only
// when its signer matches `publisherName` in the installed app's app-update.yml; a release whose publisher doesn't
// match its own signature would refuse every later update, and no later release could fix that.
// Usage: node scripts/checkWindowsSignatures.mjs   (after npm run dist, on Windows)
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const dist = join(import.meta.dirname, '..', 'dist');
const builderRequire = createRequire(createRequire(import.meta.url).resolve('electron-builder/package.json'));
const runtimeRequire = createRequire(builderRequire.resolve('builder-util-runtime/package.json'));
const { parseDn } = runtimeRequire('builder-util-runtime');
const yaml = createRequire(builderRequire.resolve('app-builder-lib/package.json'))('js-yaml');

/**
 * Whether a signer's subject matches one of the publisher names, the way electron-updater decides it
 * (windowsExecutableCodeSignatureVerifier): a name that is a full DN must match every part of it, a plain name the CN.
 */
export function publisherMatches(subject, names) {
  const signer = parseDn(subject);
  return names.some((name) => {
    const dn = parseDn(name);
    return dn.size ? [...dn.keys()].every((key) => dn.get(key) === signer.get(key)) : name === signer.get('CN');
  });
}

/** The signature of each file, from Windows itself. */
export function signatures(files) {
  const script = `$ErrorActionPreference = 'Stop'; @(${files.map((f) => `'${f.replace(/'/g, "''")}'`).join(', ')} | ForEach-Object { $s = Get-AuthenticodeSignature -LiteralPath $_; [pscustomobject]@{ Path = $_; Status = [string]$s.Status; Subject = $s.SignerCertificate.Subject } }) | ConvertTo-Json -Compress`;
  const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8' });
  return [].concat(JSON.parse(out));
}

function main() {
  const fail = (message) => {
    console.log(`::error::${message}`);
    process.exit(1);
  };
  const installers = readdirSync(dist).filter((name) => /^Hunkdory-.+-setup\.exe$/.test(name)).map((name) => join(dist, name));
  const apps = ['win-unpacked', 'win-arm64-unpacked'].map((folder) => join(dist, folder));
  const files = [...installers, ...apps.map((app) => join(app, 'Hunkdory.exe')).filter(existsSync)];
  if (installers.length !== 1 || files.length !== 3) fail(`Expected one installer and two apps, found: ${files.join(', ') || 'nothing'}`);

  // Every app must name the same publisher: it is what each installed copy checks updates against.
  const publishers = apps.map((app) => {
    const settings = yaml.load(readFileSync(join(app, 'resources', 'app-update.yml'), 'utf8')) ?? {};
    return [].concat(settings.publisherName ?? []).map(String);
  });
  const names = publishers[0];
  if (names.length === 0) fail('app-update.yml names no publisherName, so installed apps would install updates from anyone.');
  if (JSON.stringify(publishers[1]) !== JSON.stringify(names)) fail(`The two apps name different publishers: ${JSON.stringify(publishers)}`);

  let bad = false;
  for (const { Path, Status, Subject } of signatures(files)) {
    const matches = Status === 'Valid' && !!Subject && publisherMatches(Subject, names);
    console.log(`${Path}: ${Status}, signed by ${Subject || 'nobody'}${matches ? '' : ' ✗'}`);
    if (Status !== 'Valid') {
      console.log(`::error::${Path} is not validly signed (${Status}).`);
      bad = true;
    } else if (!matches) {
      console.log(`::error::${Path} is signed by ${Subject}, but the app checks updates against ${names.join(' | ')}: installed copies would refuse every later update. Fix AZURE_SIGNING_PUBLISHER (the certificate's CN, exactly).`);
      bad = true;
    }
  }
  if (bad) process.exit(1);
  console.log(`All signed by the publisher the app checks updates against (${names.join(' | ')}).`);
}

// Run as a script; imported (to check publisherMatches), it only defines.
if (process.argv[1]?.endsWith('checkWindowsSignatures.mjs')) main();
