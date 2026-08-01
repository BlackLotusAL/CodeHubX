import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GitCredentialStore,
  resolveCredential,
} from '../src/credentials.js';
import { AUTH_TYPES } from '../src/constants.js';

test('认证凭据只从 Credential Helper 读取', async () => {
  let helperReads = 0;
  const credential = await resolveCredential({
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

  assert.equal(helperReads, 1);
  assert.equal(credential.token, 'stored-secret');
  assert.equal(credential.source, 'credential_helper');
});

test('未登录时返回 AUTH_REQUIRED', async () => {
  await assert.rejects(
    resolveCredential({
      store: { get: async () => null },
      host: 'codehub.test',
    }),
    { code: 'AUTH_REQUIRED' },
  );
});

test('Git Credential Helper 通过 stdin 接收 token，token 不进入参数', async () => {
  const calls = [];
  const runGit = async (args, input, env) => {
    calls.push({ args, input, env });
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
  const store = new GitCredentialStore({
    runGit,
    env: {},
  });

  await store.save('codehub.test', AUTH_TYPES.PRIVATE_TOKEN, 'top-secret');

  assert.equal(
    calls.some((call) => call.args.join(' ').includes('top-secret')),
    false,
  );
  const approve = calls.find((call) => call.args.join(' ') === 'credential approve');
  assert.match(approve.input, /password=top-secret/);
});
