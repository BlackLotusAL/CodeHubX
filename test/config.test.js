import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import {
  createConfigStore,
  parseAndValidateConfig,
  resolveConfigPath,
} from '../src/config.js';

const VALID_CONFIG = Object.freeze({
  devuc: {
    endpoint: 'https://devuc.test/v2/w3tokens',
    appCode: 'devuc-app-code',
  },
  codehub: {
    endpoint: 'https://codehub.test/api/v4',
    appCode: 'codehub-app-code',
  },
});

test('配置路径遵循 Windows APPDATA 与 Linux XDG 约定', () => {
  assert.equal(
    resolveConfigPath({
      platform: 'win32',
      env: { APPDATA: 'D:\\Profiles\\agent\\Roaming' },
      homeDirectory: 'C:\\Users\\agent',
    }),
    'D:\\Profiles\\agent\\Roaming\\codehub\\config.json',
  );
  assert.equal(
    resolveConfigPath({
      platform: 'win32',
      env: { APPDATA: 'relative\\path' },
      homeDirectory: 'C:\\Users\\agent',
    }),
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
    resolveConfigPath({
      platform: 'linux',
      env: { XDG_CONFIG_HOME: 'relative/path' },
      homeDirectory: '/home/agent',
    }),
    '/home/agent/.config/codehub/config.json',
  );
});

test('配置支持 UTF-8 BOM 并派生 CodeHub origin 与 host', () => {
  const config = parseAndValidateConfig(
    `\uFEFF${JSON.stringify(VALID_CONFIG)}`,
    'test-config.json',
  );

  assert.equal(config.devuc.endpoint, VALID_CONFIG.devuc.endpoint);
  assert.equal(config.codehub.appCode, VALID_CONFIG.codehub.appCode);
  assert.equal(config.codehub.origin, 'https://codehub.test');
  assert.equal(config.codehub.host, 'codehub.test');
  assert.equal(Object.isFrozen(config), true);
  assert.equal(Object.isFrozen(config.codehub), true);
});

test('配置拒绝缺失、未知字段、不安全 URL 和 Header 注入', () => {
  const cases = [
    {
      name: '缺少服务',
      value: { devuc: VALID_CONFIG.devuc },
    },
    {
      name: '未知字段',
      value: { ...VALID_CONFIG, extra: true },
    },
    {
      name: '非 HTTPS',
      value: {
        ...VALID_CONFIG,
        codehub: { ...VALID_CONFIG.codehub, endpoint: 'http://codehub.test/api/v4' },
      },
    },
    {
      name: 'URL 携带 query',
      value: {
        ...VALID_CONFIG,
        devuc: { ...VALID_CONFIG.devuc, endpoint: 'https://devuc.test/login?a=1' },
      },
    },
    {
      name: 'URL 携带凭据',
      value: {
        ...VALID_CONFIG,
        codehub: {
          ...VALID_CONFIG.codehub,
          endpoint: 'https://user:password@codehub.test/api/v4',
        },
      },
    },
    {
      name: 'AppCode Header 注入',
      value: {
        ...VALID_CONFIG,
        devuc: { ...VALID_CONFIG.devuc, appCode: 'secret\r\nInjected: true' },
      },
    },
  ];

  for (const item of cases) {
    assert.throws(
      () => parseAndValidateConfig(JSON.stringify(item.value), 'test-config.json'),
      (error) => {
        assert.equal(error.code, 'CONFIG_INVALID', item.name);
        assert.equal(error.exitCode, 3, item.name);
        assert.doesNotMatch(error.message, /password|secret/, item.name);
        return true;
      },
    );
  }
});

test('config init 排他创建默认配置且重复执行不覆盖', async () => {
  const baseDirectory = await mkdtemp(join(tmpdir(), 'codehub-config-'));
  const store = tempConfigStore(baseDirectory);

  const first = await store.init();
  const firstText = await readFile(first.configPath, 'utf8');
  const second = await store.init();

  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(second.configPath, first.configPath);
  assert.deepEqual(JSON.parse(firstText), VALID_CONFIG);
  assert.equal(await readFile(first.configPath, 'utf8'), firstText);
  assert.equal((await store.load()).codehub.host, 'codehub.test');
});

test('缺少配置返回 CONFIG_REQUIRED，损坏配置不会被 init 覆盖', async () => {
  const baseDirectory = await mkdtemp(join(tmpdir(), 'codehub-config-'));
  const store = tempConfigStore(baseDirectory);

  await assert.rejects(store.load(), {
    code: 'CONFIG_REQUIRED',
    exitCode: 3,
  });

  await mkdir(dirname(store.path), { recursive: true });
  await writeFile(store.path, '{ invalid json', 'utf8');
  await assert.rejects(store.init(), { code: 'CONFIG_INVALID' });
  assert.equal(await readFile(store.path, 'utf8'), '{ invalid json');
});

function tempConfigStore(baseDirectory) {
  const location =
    process.platform === 'win32'
      ? { env: { APPDATA: baseDirectory } }
      : { env: { XDG_CONFIG_HOME: baseDirectory } };
  return createConfigStore({
    ...location,
    platform: process.platform,
    homeDirectory: baseDirectory,
    readDefaultConfig: async () => JSON.stringify(VALID_CONFIG),
  });
}
