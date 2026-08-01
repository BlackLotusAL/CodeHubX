import assert from 'node:assert/strict';
import test from 'node:test';
import { AUTH_TYPES } from '../src/constants.js';
import {
  GitCredentialStore,
  resolveCredential,
} from '../src/credentials.js';

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

test('认证类型和 token 存在同一个规范凭据中，读取只查询一次', async () => {
  const git = fakeGit();
  const store = new GitCredentialStore({ runGit: git.run, env: {} });

  await store.save(
    'codehub.test',
    AUTH_TYPES.X_AUTH_TOKEN,
    'new-auth-token',
  );

  const approve = git.calls.find((call) => call.args.at(-1) === 'approve');
  assert.match(approve.input, /username=codehub-cli/);
  assert.match(approve.input, /password=codehub-cli\/v1:/);
  assert.doesNotMatch(approve.input, /new-auth-token/);
  assert.equal(
    git.calls.some((call) => call.args.join(' ').includes('new-auth-token')),
    false,
  );

  git.calls.length = 0;
  const credential = await store.get('codehub.test');
  const fills = git.calls.filter((call) => call.args.at(-1) === 'fill');

  assert.deepEqual(credential, {
    authType: AUTH_TYPES.X_AUTH_TOKEN,
    token: 'new-auth-token',
    source: 'credential_helper',
  });
  assert.equal(fills.length, 1);
  assert.match(fills[0].input, /username=codehub-cli/);
  assert.doesNotMatch(fills[0].input, /codehub-private-token/);
});

test('所有凭据读取都强制关闭 Git 和 GCM 的交互提示', async () => {
  const git = fakeGit();
  const store = new GitCredentialStore({
    runGit: git.run,
    env: {
      GIT_TERMINAL_PROMPT: '1',
      GIT_ASKPASS: 'interactive-askpass',
      GCM_INTERACTIVE: '1',
      GCM_PROVIDER: 'github',
    },
  });

  assert.equal(await store.get('codehub.test'), null);

  const fills = git.calls.filter((call) => call.args.at(-1) === 'fill');
  assert.equal(fills.length, 3);
  for (const call of fills) {
    assert.deepEqual(call.args.slice(0, 5), [
      '-c',
      'credential.interactive=false',
      '-c',
      'credential.helper=!f() { echo quit=1; }; f',
      'credential',
    ]);
    assert.equal(call.env.GIT_TERMINAL_PROMPT, '0');
    assert.match(call.env.GIT_ASKPASS, /codehub-no-interactive-askpass/);
    assert.equal(call.env.GCM_INTERACTIVE, '0');
    assert.equal(call.env.GCM_PROVIDER, 'generic');
  }
});

test('旧版 DevUC 凭据可无交互读取并自动迁移为单一记录', async () => {
  const git = fakeGit({
    'codehub-x-auth-token': 'legacy-auth-token',
  });
  const store = new GitCredentialStore({ runGit: git.run, env: {} });

  const credential = await store.get('codehub.test');

  assert.deepEqual(credential, {
    authType: AUTH_TYPES.X_AUTH_TOKEN,
    token: 'legacy-auth-token',
    source: 'credential_helper',
  });
  assert.equal(git.records.has('codehub-cli'), true);
  assert.equal(git.records.has('codehub-x-auth-token'), false);
  assert.equal(git.records.has('codehub-private-token'), false);

  git.calls.length = 0;
  assert.equal((await store.get('codehub.test')).token, 'legacy-auth-token');
  assert.equal(
    git.calls.filter((call) => call.args.at(-1) === 'fill').length,
    1,
  );
});

test('损坏的规范凭据不会退回交互或猜测其他认证类型', async () => {
  const git = fakeGit({ 'codehub-cli': 'not-a-codehub-record' });
  const store = new GitCredentialStore({ runGit: git.run, env: {} });

  await assert.rejects(store.get('codehub.test'), {
    code: 'CREDENTIAL_ERROR',
  });
  assert.equal(
    git.calls.filter((call) => call.args.at(-1) === 'fill').length,
    1,
  );
});

test('logout 同时清理规范凭据和旧版凭据', async () => {
  const git = fakeGit({
    'codehub-cli': 'record',
    'codehub-private-token': 'private',
    'codehub-x-auth-token': 'auth',
  });
  const store = new GitCredentialStore({ runGit: git.run, env: {} });

  await store.clear('codehub.test');

  assert.equal(git.records.size, 0);
});

function fakeGit(initial = {}) {
  const records = new Map(Object.entries(initial));
  const calls = [];
  const run = async (args, input, env) => {
    calls.push({ args, input, env });
    if (args[0] === '--version') {
      return { code: 0, stdout: 'git version 2.0', stderr: '' };
    }
    if (args.includes('config')) {
      return { code: 0, stdout: 'manager\n', stderr: '' };
    }

    const operation = args.at(-1);
    const values = parseInput(input);
    if (operation === 'approve') {
      records.set(values.username, values.password);
      return { code: 0, stdout: '', stderr: '' };
    }
    if (operation === 'reject') {
      records.delete(values.username);
      return { code: 0, stdout: '', stderr: '' };
    }
    if (operation === 'fill') {
      const password = records.get(values.username);
      return password === undefined
        ? { code: 1, stdout: '', stderr: '' }
        : {
            code: 0,
            stdout: `protocol=https\nhost=${values.host}\nusername=${values.username}\npassword=${password}\n`,
            stderr: '',
          };
    }
    throw new Error(`Unexpected Git call: ${args.join(' ')}`);
  };

  return { calls, records, run };
}

function parseInput(input) {
  return Object.fromEntries(
    String(input)
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const separator = line.indexOf('=');
        return [line.slice(0, separator), line.slice(separator + 1)];
      }),
  );
}
