import assert from 'node:assert/strict';
import test from 'node:test';
import { sanitiseForOutput, stringifyKnownIds } from '../src/transform.js';

test('递归字符串化已知 ID，同时保留 SHA 与未知字段', () => {
  const result = stringifyKnownIds({
    id: 12,
    iid: 7,
    project_id: 2,
    author: { id: 99, username: 'agent' },
    commit: { id: 'aabbcc', parent_ids: ['0011'] },
    new_numeric_field: 42,
  });

  assert.deepEqual(result, {
    id: '12',
    iid: '7',
    project_id: '2',
    author: { id: '99', username: 'agent' },
    commit: { id: 'aabbcc', parent_ids: ['0011'] },
    new_numeric_field: 42,
  });
});

test('输出会移除 URL 内嵌凭据并脱敏已知 secret', () => {
  const result = sanitiseForOutput(
    {
      http_url_to_repo: 'https://user:password@example.test/group/repo.git',
      echoed: 'prefix token-value suffix',
      untouched: 'normal field',
    },
    ['token-value'],
  );

  assert.deepEqual(result, {
    http_url_to_repo: 'https://example.test/group/repo.git',
    echoed: 'prefix [REDACTED] suffix',
    untouched: 'normal field',
  });
});
