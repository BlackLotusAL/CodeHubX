import { readdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const files = [...walk('bin'), ...walk('src'), ...walk('scripts'), ...walk('test')]
  .filter((file) => extname(file) === '.js' || extname(file) === '.mjs');

for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], {
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout);
    process.exit(result.status ?? 1);
  }
}

function walk(directory) {
  try {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? walk(path) : [path];
    });
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}
