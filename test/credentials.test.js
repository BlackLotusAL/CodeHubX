import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GitCredentialStore,
  resolveCredential,
} from '../src/credentials.js';
import { AUTH_TYPES } from '../src/constants.js';

test('环境变量凭据优先于 Credential Helper', async () => {
  let helperReads = 0;
  const credential = await resolveCredential({
    env: { CODEHUB_PRIVATE_TOKEN: 'environment-secret' },
    store: {
      async get() {
        helperReads += 1;
        return {
          authType: AUTH_TYPES.X_AUTH_TOKEN,
          token: 'stored-secret',
          source: 'credential_helper',
        };
      },
    },
    host: 'codehub.test',
  });

  assert.equal(helperReads, 0);
  assert.equal(credential.token, 'environment-secret');
  assert.equal(credential.source, 'environment');
});

test('两个 token 环境变量同时存在时拒绝猜测', async () => {
  await assert.rejects(
    resolveCredential({
      env: {
        CODEHUB_PRIVATE_TOKEN: 'one',
        CODEHUB_AUTH_TOKEN: 'two',
      },
      store: { get: async () => null },
      host: 'codehub.test',
    }),
    { code: 'CONFIG_CONFLICT' },
  );
});

test('Git Credential Helper 通过 stdin 接收 token，token 不进入参数', async () => {
  const calls = [];
  const runGit = async (args, input) => {
    calls.push({ args, input });
    if (args[0] === '--version') {
      return { code: 0, stdout: 'git version 2.0', stderr: '' };
    }
    if (args.includes('config')) {
      return { code: 0, stdout: 'manager-core\n', stderr: '' };
    }
    if (args.includes('fill')) {
      return {
        code: 0,
        stdout:
          'protocol=https\nhost=codehub.test\nusername=codehub-private-token\npassword=top-secret\n',
        stderr: '',
      };
    }
    return { code: 0, stdout: '', stderr: '' };
  };
  const store = new GitCredentialStore({ runGit, env: {} });

  await store.save('codehub.test', AUTH_TYPES.PRIVATE_TOKEN, 'top-secret');

  assert.equal(
    calls.some((call) => call.args.join(' ').includes('top-secret')),
    false,
  );
  const approve = calls.find((call) => call.args.join(' ') === 'credential approve');
  assert.match(approve.input, /password=top-secret/);
});
