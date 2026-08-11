import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  CONFIG_TEMPLATE,
  createConfigStore,
  requireCodehubConfig,
  requireDevucConfig,
  resolveConfigPath,
} from '../src/config.js';
import {
  commentBody,
  devucAccount,
  devucPassword,
  mergeRequestState,
  outputFormat,
  parseTimeout,
  positiveId,
  privateToken,
  severity,
} from '../src/validation.js';

test('timeout 支持 ms、s、m 且拒绝零值、无单位和溢出', () => {
  assert.equal(parseTimeout('500ms'), 500);
  assert.equal(parseTimeout('30s'), 30_000);
  assert.equal(parseTimeout('2m'), 120_000);
  for (const value of ['0ms', '30', '-1s', '1h', '999999999999999999m']) {
    assert.throws(() => parseTimeout(value), { code: 'INVALID_ARGUMENT' });
  }
});

test('ID、输出、state、severity 和 body 校验符合协议', () => {
  assert.equal(positiveId('999999999999999999999'), '999999999999999999999');
  assert.equal(outputFormat('json'), 'json');
  assert.equal(outputFormat('human'), 'human');
  assert.equal(mergeRequestState('open'), 'opened');
  assert.equal(mergeRequestState('all'), 'all');
  assert.equal(severity('fatal'), 'fatal');
  assert.equal(commentBody(' \n'), ' \n');
  for (const value of ['', '0', '-1', '01', '1.0', 'abc']) {
    assert.throws(() => positiveId(value), { code: 'INVALID_ARGUMENT' });
  }
  assert.throws(() => outputFormat('yaml'), { code: 'INVALID_ARGUMENT' });
  assert.throws(() => mergeRequestState('opened'), { code: 'INVALID_ARGUMENT' });
  assert.throws(() => severity('critical'), { code: 'INVALID_ARGUMENT' });
  assert.throws(() => commentBody(''), { code: 'INVALID_ARGUMENT' });
});

test('登录字段严格校验且账号只允许字母数字', () => {
  assert.equal(privateToken('token-1'), 'token-1');
  assert.equal(devucAccount('Agent007'), 'Agent007');
  assert.equal(devucPassword('password'), 'password');
  for (const value of ['', 'bad\nvalue', 'bad\rvalue', 'bad\0value']) {
    assert.throws(() => privateToken(value), { code: 'INVALID_ARGUMENT' });
    assert.throws(() => devucPassword(value), { code: 'INVALID_ARGUMENT' });
  }
  for (const value of ['', 'a-b', '中文', 'a b']) {
    assert.throws(() => devucAccount(value), { code: 'INVALID_ARGUMENT' });
  }
});

test('配置路径遵循 Windows APPDATA、Linux XDG 与 home fallback', () => {
  assert.equal(
    resolveConfigPath({
      platform: 'win32',
      env: { APPDATA: 'D:\\Profiles\\agent\\Roaming' },
      homeDirectory: 'C:\\Users\\agent',
    }),
    'D:\\Profiles\\agent\\Roaming\\codehub\\config.json',
  );
  assert.equal(
    resolveConfigPath({ platform: 'win32', env: {}, homeDirectory: 'C:\\Users\\agent' }),
    'C:\\Users\\agent\\AppData\\Roaming\\codehub\\config.json',
  );
  assert.equal(
    resolveConfigPath({
      platform: 'linux',
      env: { XDG_CONFIG_HOME: '/var/config/agent' },
      homeDirectory: '/home/agent',
    }),
    '/var/config/agent/codehub/config.json',
  );
  assert.equal(
    resolveConfigPath({ platform: 'linux', env: {}, homeDirectory: '/home/agent' }),
    '/home/agent/.config/codehub/config.json',
  );
});

test('config init 排他创建空占位模板且不覆盖损坏文件', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codehub-config-'));
  const path = join(directory, 'nested', 'config.json');
  const store = createConfigStore({ path });

  const first = await store.init();
  assert.deepEqual(first, { created: true, config_path: path });
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), CONFIG_TEMPLATE);

  await writeFile(path, '{ broken', 'utf8');
  const second = await store.init();
  assert.deepEqual(second, { created: false, config_path: path });
  assert.equal(await readFile(path, 'utf8'), '{ broken');
});

test('配置加载只检查 JSON 语法并兼容 BOM', async () => {
  const values = ['[]', 'null', '42', '"value"', '\uFEFF{"codehub":{}}'];
  for (const value of values) {
    const store = createConfigStore({ read: async () => value, path: '/virtual/config.json' });
    await store.load();
  }
  const invalid = createConfigStore({ read: async () => '{ bad', path: '/virtual/config.json' });
  await assert.rejects(invalid.load(), { code: 'CONFIG_ERROR' });
});

test('命令使用配置时才校验 URL 与 AppCode', () => {
  const config = {
    codehub: { endpoint: 'https://code.test/api/v4', appCode: 'code-app' },
    devuc: { endpoint: 'https://auth.test/token?realm=dev', appCode: 'auth-app' },
    ignored: true,
  };
  assert.deepEqual(requireCodehubConfig(config), {
    endpoint: 'https://code.test/api/v4',
    appCode: 'code-app',
    origin: 'https://code.test',
  });
  assert.equal(requireDevucConfig(config).endpoint, 'https://auth.test/token?realm=dev');

  const invalid = [
    null,
    [],
    {},
    { codehub: { endpoint: '', appCode: '' } },
    { codehub: { endpoint: 'ftp://code.test/api', appCode: 'x' } },
    { codehub: { endpoint: 'https://u:p@code.test/api', appCode: 'x' } },
    { codehub: { endpoint: 'https://code.test/api?q=1', appCode: 'x' } },
    { codehub: { endpoint: 'https://code.test/api', appCode: 'bad\r\nHeader: x' } },
    { codehub: { endpoint: 'https://code.test/api', appCode: 'bad\u0001value' } },
  ];
  for (const value of invalid) {
    assert.throws(() => requireCodehubConfig(value), { code: 'CONFIG_ERROR' });
  }
});

test('配置存储 I/O 失败统一返回 CONFIG_ERROR', async () => {
  const initStore = createConfigStore({
    path: '/virtual/config.json',
    makeDirectory: async () => { throw Object.assign(new Error('denied'), { code: 'EACCES' }); },
  });
  await assert.rejects(initStore.init(), { code: 'CONFIG_ERROR' });

  const loadStore = createConfigStore({
    path: '/virtual/config.json',
    read: async () => { throw Object.assign(new Error('missing'), { code: 'ENOENT' }); },
  });
  await assert.rejects(loadStore.load(), { code: 'CONFIG_ERROR' });
});
