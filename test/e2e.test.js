import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const entry = resolve('bin/codehub.js');

test('真实进程输出简体中文帮助且未知参数返回 2', async () => {
  const help = await run(['--help']);
  assert.equal(help.code, 0);
  assert.match(help.stdout, /^用法:/);
  assert.match(help.stdout, /config|auth|repo|mr/);
  assert.equal(help.stderr, '');

  const invalid = await run(['--unknown']);
  assert.equal(invalid.code, 2);
  assert.equal(invalid.stdout, '');
  assert.deepEqual(JSON.parse(invalid.stderr), {
    code: 'INVALID_ARGUMENT',
    message: 'Invalid command argument.',
  });
});

test('真实进程在隔离用户目录创建配置且重复执行不覆盖', async () => {
  const base = await mkdtemp(join(tmpdir(), 'codehub-e2e-'));
  const env = isolatedEnv(base);
  const first = await run(['config', 'init'], env);
  assert.equal(first.code, 0);
  const result = JSON.parse(first.stdout);
  assert.equal(result.created, true);
  assert.equal(result.config_path.startsWith(base), true);
  const content = await readFile(result.config_path, 'utf8');
  assert.deepEqual(JSON.parse(content), {
    devuc: { endpoint: '', appCode: '' },
    codehub: { endpoint: '', appCode: '' },
  });

  await writeFile(result.config_path, '{ broken', 'utf8');
  const second = await run(['config', 'init'], env);
  assert.equal(second.code, 0);
  assert.equal(JSON.parse(second.stdout).created, false);
  assert.equal(await readFile(result.config_path, 'utf8'), '{ broken');
});

test('真实进程占位配置在使用时返回 CONFIG_ERROR', async () => {
  const base = await mkdtemp(join(tmpdir(), 'codehub-e2e-'));
  const env = isolatedEnv(base);
  await run(['config', 'init'], env);
  const status = await run(['auth', 'status'], env);
  assert.equal(status.code, 3);
  assert.equal(status.stdout, '');
  assert.equal(JSON.parse(status.stderr).code, 'CONFIG_ERROR');
});

test('真实非 TTY 登录在读取任何秘密前返回 INVALID_ARGUMENT', async () => {
  const base = await mkdtemp(join(tmpdir(), 'codehub-e2e-'));
  const env = isolatedEnv(base);
  const configPath = process.platform === 'win32'
    ? join(base, 'codehub', 'config.json')
    : join(base, 'codehub', 'config.json');
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, JSON.stringify({
    devuc: { endpoint: 'https://devuc.test/token', appCode: 'devuc-app' },
    codehub: { endpoint: 'https://codehub.test/api/v4', appCode: 'code-app' },
  }), 'utf8');
  const login = await run(['auth', 'login'], env);
  assert.equal(login.code, 2);
  assert.equal(login.stdout, '');
  assert.deepEqual(JSON.parse(login.stderr), {
    code: 'INVALID_ARGUMENT',
    message: 'Invalid command argument.',
  });
});

async function run(args, env = process.env) {
  try {
    const result = await execFileAsync(process.execPath, [entry, ...args], {
      cwd: process.cwd(),
      env,
      windowsHide: true,
      encoding: 'utf8',
      timeout: 10_000,
    });
    return { code: 0, ...result };
  } catch (error) {
    return {
      code: error.code,
      stdout: error.stdout ?? '',
      stderr: error.stderr ?? '',
    };
  }
}

function isolatedEnv(base) {
  return {
    ...process.env,
    APPDATA: base,
    XDG_CONFIG_HOME: base,
    HOME: base,
    USERPROFILE: base,
    NO_COLOR: '',
  };
}
