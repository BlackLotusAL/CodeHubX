import assert from 'node:assert/strict';
import test from 'node:test';
import { KeyringCredentialStore, privateCredential } from '../src/credentials.js';

test('系统凭据库真实 save/get/delete 冒烟', {
  skip: process.env.CODEHUB_KEYRING_SMOKE !== '1'
    ? '仅在已提供系统 Credential Helper 的验收环境运行'
    : false,
}, async () => {
  const store = new KeyringCredentialStore({ service: 'codehub-cli-acceptance' });
  const origin = `https://credential-smoke-${process.pid}-${Date.now()}.invalid`;
  try {
    await store.save(origin, privateCredential('disposable-test-secret'));
    assert.deepEqual(await store.get(origin), privateCredential('disposable-test-secret'));
  } finally {
    await store.clear(origin);
  }
  assert.equal(await store.get(origin), null);
});
