/**
 * Screenshots of the page: builds, then runs the browser test with `--shots`.
 *
 *   npm run shots                  # -> shots/
 *   npm run shots -- shots/before  # -> shots/before/
 */
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { root } from './load.mjs';

const dir = resolve(process.argv[2] ?? 'shots');
for (const args of [['build.mjs'], ['tests/app.mjs', '--shots', dir]]) {
  const { status } = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit' });
  if (status !== 0) process.exit(status ?? 1);
}
console.log(`screenshots in ${dir}`);
