import assert from 'node:assert/strict';
import test from 'node:test';
import { createAuthenticationSession } from '../src/authentication.js';
import {
  DEVUC_REFRESH_LEEWAY_MS,
  DEVUC_VALIDITY_MS,
} from '../src/constants.js';
import {
  MemoryCredentialStore,
  devucCredential,
  privateCredential,
} from '../src/credentials.js';
import { CliError } from '../src/errors.js';
import { configStore, validConfig } from '../test-support/helpers.js';

const ORIGIN = 'https://codehub.test';

test('认证会话通过一个 interface 完成登录、状态和幂等退出', async () => {
  const store = new MemoryCredentialStore();
  let networkCalls = 0;
  const session = createAuthenticationSession({
    configStore: configStore(validConfig({ devuc: { endpoint: '', appCode: '' } })),
    credentialStore: store,
    prompter: {
      chooseAuthenticationType: async () => 'private_token',
      readPrivateToken: async () => 'private-secret',
    },
    clientFactory: () => { networkCalls += 1; },
  });

  assert.deepEqual(await session.login(), {
    configured: true,
    authentication_type: 'private_token',
    api_host: ORIGIN,
  });
  assert.deepEqual(await session.status(), {
    configured: true,
    authentication_type: 'private_token',
    api_host: ORIGIN,
  });
  assert.deepEqual(await store.get(ORIGIN), privateCredential('private-secret'));
  assert.deepEqual(await session.logout(), {
    credential_helper_cleared: true,
    api_host: ORIGIN,
  });
  assert.deepEqual(await session.logout(), {
    credential_helper_cleared: true,
    api_host: ORIGIN,
  });
  assert.equal(await store.get(ORIGIN), null);
  assert.equal(networkCalls, 0);
});

test('认证会话隐藏 DevUC 登录细节并保存刷新所需凭据', async () => {
  const store = new MemoryCredentialStore();
  const calls = [];
  const issuedAt = 1_765_000_000_000;
  const session = createAuthenticationSession({
    configStore: configStore(),
    credentialStore: store,
    now: () => issuedAt,
    timeoutMs: 120_000,
    prompter: {
      chooseAuthenticationType: async () => 'devuc',
      readDevucCredentials: async () => ({ account: 'Agent01', password: 'password-secret' }),
    },
    clientFactory: (options) => ({
      devucLogin: async (account, password) => {
        calls.push({ options, account, password });
        return 'new-token-secret';
      },
    }),
  });

  assert.deepEqual(await session.login(), {
    configured: true,
    authentication_type: 'devuc',
    api_host: ORIGIN,
  });
  assert.equal(calls[0].options.timeoutMs, 120_000);
  assert.equal(calls[0].options.devuc.endpoint, 'https://devuc.test/v2/w3tokens');
  assert.deepEqual(await store.get(ORIGIN), devucCredential({
    account: 'Agent01',
    password: 'password-secret',
    token: 'new-token-secret',
    issuedAtMs: issuedAt,
  }));
});

test('认证会话在刷新阈值前直接形成已认证 CodeHub 能力', async () => {
  const issuedAt = 1_000;
  const store = new MemoryCredentialStore([[ORIGIN, devucCredential({
    account: 'Agent1',
    password: 'password',
    token: 'old-token',
    issuedAtMs: issuedAt,
  })]]);
  const contexts = [];
  const capability = { listProjects: async () => [] };
  const session = createAuthenticationSession({
    configStore: configStore(validConfig({ devuc: { endpoint: '', appCode: '' } })),
    credentialStore: store,
    now: () => issuedAt + DEVUC_VALIDITY_MS - DEVUC_REFRESH_LEEWAY_MS - 1,
    clientFactory: (options) => {
      contexts.push(options);
      return capability;
    },
  });

  assert.deepEqual(await session.codehub(), { client: capability });
  assert.equal(contexts.length, 1);
  assert.equal(contexts[0].credential.token, 'old-token');
});

test('认证会话在精确阈值先刷新并保存，再形成 CodeHub 能力', async () => {
  const issuedAt = 10_000;
  const boundary = issuedAt + DEVUC_VALIDITY_MS - DEVUC_REFRESH_LEEWAY_MS;
  const events = [];
  class TrackingStore extends MemoryCredentialStore {
    async save(origin, credential) {
      events.push(`save:${credential.token}`);
      return super.save(origin, credential);
    }
  }
  const store = new TrackingStore([[ORIGIN, devucCredential({
    account: 'Agent1',
    password: 'password',
    token: 'old-token',
    issuedAtMs: issuedAt,
  })]]);
  const capability = { listProjects: async () => [] };
  const session = createAuthenticationSession({
    configStore: configStore(),
    credentialStore: store,
    now: () => boundary,
    clientFactory: (options) => {
      if (options.devuc) return {
        devucLogin: async () => {
          events.push('refresh');
          return 'new-token';
        },
      };
      events.push(`capability:${options.credential.token}`);
      return capability;
    },
  });

  assert.deepEqual(await session.codehub(), { client: capability });
  assert.deepEqual(events, ['refresh', 'save:new-token', 'capability:new-token']);
  assert.equal((await store.get(ORIGIN)).issued_at_ms, boundary);
});

test('认证会话在缺少凭据、刷新失败或保存失败时不形成 CodeHub 能力', async () => {
  let capabilityCalls = 0;
  const emptySession = createAuthenticationSession({
    configStore: configStore(),
    credentialStore: new MemoryCredentialStore(),
    clientFactory: () => { capabilityCalls += 1; },
  });
  await assert.rejects(emptySession.codehub(), { code: 'AUTH_ERROR' });

  for (const mode of ['refresh', 'save']) {
    const base = new MemoryCredentialStore([[ORIGIN, devucCredential({
      account: 'Agent1',
      password: 'password',
      token: 'old-token',
      issuedAtMs: 0,
    })]]);
    const store = mode === 'save'
      ? {
          get: (...args) => base.get(...args),
          save: async () => { throw new CliError('AUTH_ERROR'); },
        }
      : base;
    const session = createAuthenticationSession({
      configStore: configStore(),
      credentialStore: store,
      now: () => DEVUC_VALIDITY_MS,
      clientFactory: (options) => {
        if (options.devuc) return {
          devucLogin: async () => {
            if (mode === 'refresh') throw new CliError('AUTH_ERROR');
            return 'new-token';
          },
        };
        capabilityCalls += 1;
        return {};
      },
    });
    await assert.rejects(session.codehub(), { code: 'AUTH_ERROR' });
  }

  assert.equal(capabilityCalls, 0);
});
