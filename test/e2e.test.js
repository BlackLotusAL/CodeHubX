import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
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
  assert.match(human.stdout, /写入必须确认: 是/);
  assert.equal(human.stderr, '');
});
