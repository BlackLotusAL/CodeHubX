import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const destination = await mkdtemp(join(tmpdir(), 'codehub-pack-'));
const installDirectory = await mkdtemp(join(tmpdir(), 'codehub-install-'));
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('npm_execpath is unavailable; run this script through npm.');

// The enclosing verify command already runs static checks and coverage. Skipping lifecycle
// scripts here prevents this smoke pack from executing prepack and repeating those gates.
run(
  process.execPath,
  [npmCli, 'pack', '--ignore-scripts', '--json', '--pack-destination', destination],
  root,
);
const tarball = join(destination, 'codehub-cli-0.1.0.tgz');
await stat(tarball);

run(process.execPath, [npmCli, 'init', '-y'], installDirectory);
run(process.execPath, [npmCli, 'install', '--ignore-scripts', tarball], installDirectory);

const installedPackage = JSON.parse(
  await readFile(join(installDirectory, 'node_modules', 'codehub-cli', 'package.json'), 'utf8'),
);
assert.equal(installedPackage.name, 'codehub-cli');
assert.equal(installedPackage.version, '0.1.0');
assert.equal(installedPackage.bin.codehub, './bin/codehub.js');

const cli = resolve(installDirectory, 'node_modules', 'codehub-cli', 'bin', 'codehub.js');
const help = run(process.execPath, [cli, '--help'], installDirectory);
assert.match(help.stdout, /^用法:/);

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.stderr.write(result.stdout ?? '');
    process.stderr.write(result.stderr ?? '');
    process.exit(result.status ?? 1);
  }
  return result;
}
