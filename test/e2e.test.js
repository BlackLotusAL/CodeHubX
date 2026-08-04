import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const bin = fileURLToPath(new URL('../bin/codehub.js', import.meta.url));

test('真实进程可执行 version 和 human capabilities', async () => {
  const version = await execFileAsync(process.execPath, [
    bin,
    'version',
    '--request-id',
    'e2e-version',
  ]);
  const envelope = JSON.parse(version.stdout);
  assert.equal(envelope.command, 'version');
  assert.equal(envelope.request_id, 'e2e-version');
  assert.equal(version.stderr, '');

  const human = await execFileAsync(process.execPath, [
    bin,
    'capabilities',
    '--output',
    'human',
  ]);
  assert.match(human.stdout, /写入必须确认\s+是/);
  assert.equal(human.stderr, '');
});

test('真实进程可在用户目录初始化配置且不输出配置值', async (t) => {
  const baseDirectory = await mkdtemp(join(tmpdir(), 'codehub-e2e-config-'));
  t.after(() => rm(baseDirectory, { recursive: true, force: true }));
  const env = { ...process.env };
  if (process.platform === 'win32') {
    env.APPDATA = baseDirectory;
  } else {
    env.XDG_CONFIG_HOME = baseDirectory;
  }

  const first = await execFileAsync(
    process.execPath,
    [bin, 'config', 'init', '--output', 'json'],
    { env },
  );
  const firstEnvelope = JSON.parse(first.stdout);
  const configText = await readFile(firstEnvelope.data.config_path, 'utf8');
  const config = JSON.parse(configText);
  const second = await execFileAsync(
    process.execPath,
    [bin, 'config', 'init', '--output', 'json'],
    { env },
  );

  assert.equal(firstEnvelope.data.created, true);
  assert.equal(JSON.parse(second.stdout).data.created, false);
  assert.equal(typeof config.devuc.endpoint, 'string');
  assert.equal(typeof config.devuc.appCode, 'string');
  assert.equal(typeof config.codehub.endpoint, 'string');
  assert.equal(typeof config.codehub.appCode, 'string');
  assert.doesNotMatch(first.stdout, /sicarrier|X-Apig-AppCode|appCode/);
  assert.equal(first.stderr, '');
  assert.equal(second.stderr, '');
});
