import assert from 'node:assert/strict';
import test from 'node:test';
import { loadConfig } from '../src/config.js';
import { DEFAULTS } from '../src/constants.js';

test('服务地址和 AppCode 始终使用内置配置', () => {
  const config = loadConfig();

  assert.equal(config.apiBaseUrl, DEFAULTS.apiBaseUrl);
  assert.equal(config.apiAppCode, DEFAULTS.apiAppCode);
  assert.equal(config.devucUrl, DEFAULTS.devucUrl);
  assert.equal(config.devucAppCode, DEFAULTS.devucAppCode);
});
