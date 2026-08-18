import assert from 'node:assert/strict';
import test from 'node:test';
import { AUTH_TYPES } from '../src/constants.js';
import {
  KeyringCredentialStore,
  MemoryCredentialStore,
  devucCredential,
  parseCredentialRecord,
  privateCredential,
  serialiseCredentialRecord,
} from '../src/credentials.js';

test('Private Token 与 DevUC 凭据使用稳定版本化记录', () => {
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
