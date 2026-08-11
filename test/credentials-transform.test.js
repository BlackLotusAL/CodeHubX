import assert from 'node:assert/strict';
import test from 'node:test';
import { AUTH_TYPES } from '../src/constants.js';
import {
  KeyringCredentialStore,
  MemoryCredentialStore,
  credentialSecrets,
  devucCredential,
  parseCredentialRecord,
  privateCredential,
  serialiseCredentialRecord,
} from '../src/credentials.js';
import {
  idOrNull,
  projectCommentResult,
  projectCommitList,
  projectMergeRequestList,
  projectMergeRequestView,
  projectRepoList,
  projectRepoView,
} from '../src/transform.js';
import {
  commentApiFixture,
  commitApiFixture,
  mergeRequestApiFixture,
  repoApiFixture,
} from '../test-support/fixtures.js';

test('private 与 DevUC 凭据使用稳定版本化记录', () => {
  const privateValue = privateCredential('private-secret');
  assert.deepEqual(privateValue, {
    version: 1,
    authentication_type: 'private_token',
    token: 'private-secret',
  });
  assert.deepEqual(parseCredentialRecord(serialiseCredentialRecord(privateValue)), privateValue);

  const devucValue = devucCredential({
    account: 'Agent01',
    password: 'password',
    token: 'devuc-secret',
    issuedAtMs: 123,
  });
  assert.equal(devucValue.authentication_type, AUTH_TYPES.DEVUC);
  assert.deepEqual(credentialSecrets(devucValue), ['Agent01', 'password', 'devuc-secret']);
  assert.deepEqual(parseCredentialRecord(serialiseCredentialRecord(devucValue)), devucValue);
});

test('损坏或不完整的凭据记录返回 AUTH_ERROR', () => {
  const records = [
    'bad json',
    '{}',
    JSON.stringify({ version: 2, authentication_type: 'private_token', token: 'x' }),
    JSON.stringify({ version: 1, authentication_type: 'private_token', token: '' }),
    JSON.stringify({ version: 1, authentication_type: 'devuc', account: 'bad-name', password: 'x', token: 'y', issued_at_ms: 1 }),
  ];
  for (const record of records) {
    assert.throws(() => parseCredentialRecord(record), { code: 'AUTH_ERROR' });
  }
});

test('MemoryCredentialStore 支持覆盖、隔离 origin 和幂等清除', async () => {
  const store = new MemoryCredentialStore();
  await store.save('https://one.test', privateCredential('one'));
  await store.save('https://two.test', privateCredential('two'));
  await store.save('https://one.test', privateCredential('replacement'));
  assert.equal((await store.get('https://one.test')).token, 'replacement');
  assert.equal((await store.get('https://two.test')).token, 'two');
  await store.clear('https://one.test');
  await store.clear('https://one.test');
  assert.equal(await store.get('https://one.test'), null);
});

test('KeyringCredentialStore 使用 service/origin 单记录并处理 NoEntry', async () => {
  class FakeEntry {
    static values = new Map();
    constructor(service, account) {
      this.key = `${service}|${account}`;
    }
    getPassword() {
      if (!FakeEntry.values.has(this.key)) throw Object.assign(new Error('NoEntry'), { code: 'NoEntry' });
      return FakeEntry.values.get(this.key);
    }
    setPassword(value) { FakeEntry.values.set(this.key, value); }
    deletePassword() {
      if (!FakeEntry.values.delete(this.key)) throw Object.assign(new Error('NoEntry'), { code: 'NoEntry' });
    }
  }
  const store = new KeyringCredentialStore({ EntryClass: FakeEntry, service: 'test-service' });
  assert.equal(await store.get('https://code.test'), null);
  await store.save('https://code.test', privateCredential('secret'));
  assert.equal((await store.get('https://code.test')).token, 'secret');
  await store.clear('https://code.test');
  await store.clear('https://code.test');
  assert.equal(await store.get('https://code.test'), null);
});

test('KeyringCredentialStore 将后端和损坏记录错误统一为 AUTH_ERROR', async () => {
  class BrokenEntry {
    constructor() {}
    getPassword() { throw new Error('backend unavailable'); }
    setPassword() { throw new Error('backend unavailable'); }
    deletePassword() { throw new Error('backend unavailable'); }
  }
  const broken = new KeyringCredentialStore({ EntryClass: BrokenEntry });
  await assert.rejects(broken.get('https://code.test'), { code: 'AUTH_ERROR' });
  await assert.rejects(broken.save('https://code.test', privateCredential('x')), { code: 'AUTH_ERROR' });
  await assert.rejects(broken.clear('https://code.test'), { code: 'AUTH_ERROR' });

  class CorruptEntry extends BrokenEntry {
    getPassword() { return '{invalid'; }
  }
  await assert.rejects(
    new KeyringCredentialStore({ EntryClass: CorruptEntry }).get('https://code.test'),
    { code: 'AUTH_ERROR' },
  );
});

test('Project 投影只保留固定字段并使用请求 ID 补足', () => {
  const list = projectRepoList([repoApiFixture]);
  assert.deepEqual(list, [{
    repo_id: '9001',
    full_name: 'platform/agent-tools',
    clone_urls: {
      ssh: 'git@codehub.test:platform/agent-tools.git',
      https: 'https://codehub.test/platform/agent-tools.git',
    },
    archived: false,
    updated_at: '2026-07-31T08:00:00Z',
  }]);
  assert.equal('permissions' in list[0], false);

  const view = projectRepoView({}, '123');
  assert.deepEqual(view, {
    repo_id: '123',
    full_name: null,
    clone_urls: { ssh: null, https: null },
    archived: null,
    updated_at: null,
    default_branch: null,
    web_url: null,
  });
});

test('MR 列表与详情规范化作者、labels、changes 并排除无关字段', () => {
  const summary = projectMergeRequestList([mergeRequestApiFixture])[0];
  assert.equal(summary.repo_id, '9001');
  assert.equal(summary.mr_id, '701');
  assert.equal(summary.iid, '17');
  assert.deepEqual(summary.author, {
    id: '88',
    username: 'lin',
    name: '林开发者',
    type: 'user',
  });
  assert.equal('email' in summary.author, false);
  assert.equal('assignee' in summary, false);

  const detail = projectMergeRequestView(mergeRequestApiFixture, '9001', '17');
  assert.deepEqual(detail.labels, ['cli', 'review-ready']);
  assert.deepEqual(detail.changes, { files: 12, additions: 83, deletions: 21 });
  assert.equal(detail.description, mergeRequestApiFixture.description);
});

test('Commit 与评论结果使用稳定形状和 null 规则', () => {
  const commit = projectCommitList([commitApiFixture])[0];
  assert.equal(commit.sha, commitApiFixture.id);
  assert.deepEqual(commit.author, { name: 'Lin Developer', email: 'lin@example.test' });
  assert.deepEqual(commit.committer, { name: 'CI Bot', email: 'ci@example.test' });
  assert.deepEqual(commit.parent_shas, commitApiFixture.parent_ids);
  assert.equal('stats' in commit, false);

  const comment = projectCommentResult(commentApiFixture, {
    repoId: '9001',
    mrIid: '17',
    severity: 'major',
  });
  assert.deepEqual(comment, {
    comment_id: 'discussion-1',
    repo_id: '9001',
    mr_iid: '17',
    severity: 'major',
    resolved: false,
    web_url: commentApiFixture.web_url,
  });
  assert.equal('notes' in comment, false);
});

test('ID 转换避免不安全数值并支持 bigint', () => {
  assert.equal(idOrNull(42), '42');
  assert.equal(idOrNull(42n), '42');
  assert.equal(idOrNull('0001'), '0001');
  assert.equal(idOrNull(Number.MAX_SAFE_INTEGER + 1), null);
  assert.equal(idOrNull(-1), null);
  assert.equal(idOrNull(null), null);
});
