import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, extname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const root = process.cwd();
const files = [...walk('bin'), ...walk('src'), ...walk('scripts'), ...walk('test')].filter(
  (file) => extname(file) === '.js' || extname(file) === '.mjs',
);

for (const file of files) {
  run(process.execPath, ['--check', file]);
}

const eslintCli = join(dirname(require.resolve('eslint/package.json')), 'bin', 'eslint.js');
const prettierCli = join(dirname(require.resolve('prettier/package.json')), 'bin', 'prettier.cjs');

run(process.execPath, [eslintCli, '.', '--max-warnings', '0']);
run(process.execPath, [prettierCli, '.', '--check']);

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

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
  });
  process.stdout.write(result.stdout ?? '');
  process.stderr.write(result.stderr ?? '');
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
