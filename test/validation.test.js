import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parsePositiveId,
  parseTimeout,
  stripOneTrailingNewline,
  validateHttpsUrl,
  validateRequestId,
  validateState,
} from '../src/validation.js';

test('timeout 支持 ms、s、m 并拒绝零值与无单位数值', () => {
  assert.equal(parseTimeout('500ms'), 500);
  assert.equal(parseTimeout('30s'), 30_000);
  assert.equal(parseTimeout('2m'), 120_000);
  assert.throws(() => parseTimeout('0s'), { code: 'INVALID_ARGUMENT' });
  assert.throws(() => parseTimeout('30'), { code: 'INVALID_ARGUMENT' });
});

test('ID 与 request ID 严格执行机器协议约束', () => {
  assert.equal(parsePositiveId('9007199254740993123', 'ID'), '9007199254740993123');
  assert.throws(() => parsePositiveId('0', 'ID'), { code: 'INVALID_ARGUMENT' });
  assert.throws(() => parsePositiveId('1.5', 'ID'), { code: 'INVALID_ARGUMENT' });
  assert.equal(validateRequestId('agent:run_1.2-3'), 'agent:run_1.2-3');
  assert.throws(() => validateRequestId('has space'), {
    code: 'INVALID_ARGUMENT',
  });
});

test('open 状态映射为服务端 opened', () => {
  assert.equal(validateState('open'), 'opened');
  assert.equal(validateState('all'), 'all');
  assert.throws(() => validateState('opened'), { code: 'INVALID_ARGUMENT' });
});

test('URL 覆盖必须是 HTTPS 且不能包含凭据', () => {
  assert.equal(
    validateHttpsUrl('https://example.test/api/', 'TEST_URL'),
    'https://example.test/api',
  );
  assert.throws(() => validateHttpsUrl('http://example.test', 'TEST_URL'), {
    code: 'INVALID_ARGUMENT',
  });
  assert.throws(
    () => validateHttpsUrl('https://user:pass@example.test', 'TEST_URL'),
    { code: 'INVALID_ARGUMENT' },
  );
});

test('stdin token 只移除末尾一个换行', () => {
  assert.equal(stripOneTrailingNewline('token\n'), 'token');
  assert.equal(stripOneTrailingNewline('token\r\n'), 'token');
  assert.equal(stripOneTrailingNewline('token\n\n'), 'token\n');
  assert.equal(stripOneTrailingNewline(' token '), ' token ');
});
