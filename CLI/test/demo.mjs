// node test/demo.mjs  → builds the fixture repo and runs wtv against it
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildFixture } from './fixture.mjs';

const { dir } = buildFixture();
const bin = fileURLToPath(new URL('../bin/wtv.mjs', import.meta.url));
console.log(`Fixture repo: ${dir}\n`);
try {
  execFileSync(process.execPath, [bin, 'verify'], { cwd: dir, stdio: 'inherit' });
} catch {
  // exit code 1 is the expected outcome here
}
