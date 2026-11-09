// Packages Hunkdory for Windows (npm run dist:win, on Windows): one installer for x64 and Arm64, its .blockmap and the
// update feed latest.yml. Signs with Azure Trusted Signing when its settings are set, as the release workflow does, or
// with a certificate file (WIN_CSC_LINK, read by electron-builder itself). Afterwards it checks that both builds kept
// Chromium's English locale. Other arguments (--publish never) are passed on to electron-builder.
// Usage: node scripts/dist-win.mjs [electron-builder arguments]   (npm run dist:win runs electron-vite build first)
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const appDir = join(import.meta.dirname, '..');

/**
 * Azure Trusted Signing's settings, from these variables (docs/development.md → Windows). The credentials aren't here:
 * the TrustedSigning module electron-builder runs finds them itself (the release workflow's Azure CLI login, or
 * AZURE_TENANT_ID, AZURE_CLIENT_ID and AZURE_CLIENT_SECRET locally).
 */
const AZURE_SIGNING = {
  endpoint: 'AZURE_SIGNING_ENDPOINT',
  codeSigningAccountName: 'AZURE_SIGNING_ACCOUNT',
  certificateProfileName: 'AZURE_SIGNING_PROFILE',
  // Also written to the app's update settings: an update must be signed by the same publisher to install.
  publisherName: 'AZURE_SIGNING_PUBLISHER',
};

/** electron-builder's azureSignOptions from the environment, or null when none are set. Throws when only some are. Pure. */
export function azureSignOptions(env) {
  const set = Object.entries(AZURE_SIGNING).filter(([, name]) => env[name]);
  if (!set.length) return null;
  const missing = Object.values(AZURE_SIGNING).filter((name) => !env[name]);
  if (missing.length) throw new Error(`Azure Trusted Signing needs ${missing.join(', ')} too.`);
  return Object.fromEntries(set.map(([option, name]) => [option, env[name]]));
}

/** The unpacked app of each architecture. */
const BUILDS = ['win-unpacked', 'win-arm64-unpacked'];

/**
 * Fails the build when a build has no en-US.pak: without a locale file Chromium falls back to none, app.getLocale()
 * returns '' and Intl throws on it. electronLanguages keeps whole file names (electron-builder.yml).
 */
function checkLocales() {
  for (const build of BUILDS) {
    const locales = join(appDir, 'dist', build, 'locales');
    if (existsSync(join(appDir, 'dist', build)) && !existsSync(join(locales, 'en-US.pak'))) return `${locales} has no en-US.pak. Check electronLanguages in electron-builder.yml.`;
  }
  return null;
}

function main() {
  if (process.platform !== 'win32') {
    console.error('The Windows installer is built on Windows.');
    process.exit(1);
  }
  let azure;
  try {
    azure = azureSignOptions(process.env);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
  // In a config file that extends electron-builder.yml: given as -c. options, electron-builder would read a value that
  // looks like a number or a boolean as one.
  const dir = mkdtempSync(join(tmpdir(), 'hunkdory-dist-'));
  const config = join(dir, 'electron-builder.windows.json');
  writeFileSync(config, JSON.stringify({ extends: join(appDir, 'electron-builder.yml'), ...(azure && { win: { azureSignOptions: azure } }) }, null, 2));

  const builderRequire = createRequire(createRequire(import.meta.url).resolve('electron-builder/package.json'));
  // electron-builder's 7-Zip compresses Arm64 .exe and .dll files with its ARM64 filter unless told otherwise, and the
  // plugin that unpacks them in the installer (Nsis7z) can't read that filter. It skips them without an error, so the
  // installer reports success on an Arm64 PC and leaves no Hunkdory.exe. BCJ is a filter the plugin can read.
  const env = { ...process.env, ELECTRON_BUILDER_7Z_FILTER: 'BCJ' };
  const result = spawnSync(process.execPath, [builderRequire.resolve('./cli.js'), '--win', '--config', config, ...process.argv.slice(2)], { stdio: 'inherit', env, cwd: appDir });
  rmSync(dir, { recursive: true, force: true });
  if (result.status !== 0) process.exit(result.status ?? 1);
  const problem = checkLocales();
  if (problem) {
    console.error(`✗ ${problem}`);
    process.exit(1);
  }
}

// Run as a script; imported (to check azureSignOptions), it only defines.
if (process.argv[1]?.endsWith('dist-win.mjs')) main();
