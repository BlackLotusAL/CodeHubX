import assert from 'node:assert/strict';
import test from 'node:test';
import { runCli } from '../src/cli.js';
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
import {
  commentApiFixture,
  commitApiFixture,
  mergeRequestApiFixture,
  repoApiFixture,
} from '../test-support/fixtures.js';
import {
  captureIo,
  configStore,
  parseSingleJson,
  validConfig,
} from '../test-support/helpers.js';

const ORIGIN = 'https://codehub.test';

test('config init 不加载配置、凭据或网络并默认输出 JSON', async () => {
  const { io, capture } = captureIo();
  const calls = [];
  const exitCode = await runCli(['config', 'init'], {
    io,
    configStore: {
      init: async () => ({ created: true, config_path: '/config/codehub/config.json' }),
      load: async () => { throw new Error('must not load'); },
    },
    credentialStore: failCredentialStore(),
    apiFactory: () => { calls.push('network'); },
  });
  assert.equal(exitCode, 0);
  assert.deepEqual(parseSingleJson(capture.stdout), {
    created: true,
    config_path: '/config/codehub/config.json',
  });
  assert.equal(capture.stderr, '');
  assert.deepEqual(calls, []);
});

test('private token 登录交互保存单一系统凭据记录', async () => {
  const { io, capture } = captureIo();
  const store = new MemoryCredentialStore();
  const exitCode = await runCli(['auth', 'login'], {
    io,
    configStore: configStore(validConfig({ devuc: { endpoint: '', appCode: '' } })),
    credentialStore: store,
    prompter: {
      chooseAuthenticationType: async () => 'private_token',
      readPrivateToken: async () => 'private-secret',
    },
    apiFactory: () => { throw new Error('must not access network'); },
  });
  assert.equal(exitCode, 0);
  assert.deepEqual(parseSingleJson(capture.stdout), {
    configured: true,
    authentication_type: 'private_token',
    api_host: ORIGIN,
  });
  assert.deepEqual(await store.get(ORIGIN), privateCredential('private-secret'));
  assert.doesNotMatch(`${capture.stdout}${capture.stderr}`, /private-secret/);
});

test('DevUC 登录请求 newToken 并保存账号、密码、token 和签发时间', async () => {
  const { io, capture } = captureIo();
  const store = new MemoryCredentialStore();
  const apiCalls = [];
  const now = 1_765_000_000_000;
  const exitCode = await runCli(['auth', 'login', '--timeout', '2m'], {
    io,
    configStore: configStore(),
    credentialStore: store,
    now: () => now,
    prompter: {
      chooseAuthenticationType: async () => 'devuc',
      readDevucCredentials: async () => ({ account: 'Agent01', password: 'password-secret' }),
    },
    apiFactory: (options) => ({
      devucLogin: async (account, password) => {
        apiCalls.push({ options, account, password });
        return 'new-token-secret';
      },
    }),
  });
  assert.equal(exitCode, 0);
  assert.equal(apiCalls[0].options.timeoutMs, 120_000);
  assert.equal(apiCalls[0].options.devuc.endpoint, 'https://devuc.test/v2/w3tokens');
  assert.deepEqual(await store.get(ORIGIN), devucCredential({
    account: 'Agent01',
    password: 'password-secret',
    token: 'new-token-secret',
    issuedAtMs: now,
  }));
  assert.doesNotMatch(
    `${capture.stdout}${capture.stderr}`,
    /Agent01|password-secret|new-token-secret|devuc-app-code|codehub-app-code/,
  );
});

test('登录取消与凭据保存失败映射稳定错误且 stdout 为空', async () => {
  for (const [prompter, store, expectedCode, expectedExit] of [
    [
      { chooseAuthenticationType: async () => { throw new CliError('CANCELLED'); } },
      new MemoryCredentialStore(),
      'CANCELLED',
      130,
    ],
    [
      {
        chooseAuthenticationType: async () => 'private_token',
        readPrivateToken: async () => 'secret',
      },
      { save: async () => { throw new CliError('AUTH_ERROR'); } },
      'AUTH_ERROR',
      3,
    ],
  ]) {
    const { io, capture } = captureIo();
    const exit = await runCli(['auth', 'login'], {
      io,
      configStore: configStore(),
      credentialStore: store,
      prompter,
    });
    assert.equal(exit, expectedExit);
    assert.equal(capture.stdout, '');
    assert.equal(parseSingleJson(capture.stderr).code, expectedCode);
  }
});

test('auth status 只读取当前 origin 凭据，未登录字段为 null', async () => {
  for (const credential of [null, privateCredential('secret')]) {
    const { io, capture } = captureIo();
    let networkCalls = 0;
    const store = new MemoryCredentialStore(
      credential ? [[ORIGIN, credential]] : [],
    );
    const exit = await runCli(['auth', 'status'], {
      io,
      configStore: configStore(),
      credentialStore: store,
      apiFactory: () => { networkCalls += 1; },
    });
    assert.equal(exit, 0);
    assert.deepEqual(parseSingleJson(capture.stdout), {
      configured: Boolean(credential),
      authentication_type: credential?.authentication_type ?? null,
      api_host: ORIGIN,
    });
    assert.equal(networkCalls, 0);
    assert.doesNotMatch(capture.stdout, /secret/);
  }
});

test('auth logout 幂等清除完整记录且不访问网络', async () => {
  const store = new MemoryCredentialStore([[ORIGIN, devucCredential({
    account: 'Agent1',
    password: 'password',
    token: 'token',
    issuedAtMs: 1,
  })]]);
  for (let index = 0; index < 2; index += 1) {
    const { io, capture } = captureIo();
    const exit = await runCli(['auth', 'logout'], {
      io,
      configStore: configStore(),
      credentialStore: store,
      apiFactory: () => { throw new Error('must not call'); },
    });
    assert.equal(exit, 0);
    assert.deepEqual(parseSingleJson(capture.stdout), {
      credential_helper_cleared: true,
      api_host: ORIGIN,
    });
  }
  assert.equal(await store.get(ORIGIN), null);
});

test('所有业务命令输出规定的直接 JSON 结构', async () => {
  const cases = [
    [['repo', 'list', '8'], 'listProjects', [repoApiFixture], (value) => {
      assert.equal(Array.isArray(value), true);
      assert.equal(value[0].repo_id, '9001');
    }],
    [['repo', 'view', '9001'], 'viewProject', repoApiFixture, (value) => {
      assert.equal(value.default_branch, 'main');
    }],
    [['mr', 'list', '--project-id', '9001'], 'listMergeRequests', [mergeRequestApiFixture], (value) => {
      assert.equal(value[0].iid, '17');
    }],
    [['mr', 'view', '17', '--project-id', '9001'], 'viewMergeRequest', mergeRequestApiFixture, (value) => {
      assert.deepEqual(value.changes, { files: 12, additions: 83, deletions: 21 });
    }],
    [['mr', 'commits', '17', '--project-id', '9001'], 'listMergeRequestCommits', [commitApiFixture], (value) => {
      assert.equal(value[0].sha, commitApiFixture.id);
    }],
    [[
      'mr', 'comment', 'create', '17', '--project-id', '9001',
      '--body', '保持原样\n$()', '--severity', 'major',
    ], 'createMergeRequestComment', commentApiFixture, (value) => {
      assert.equal(value.comment_id, 'discussion-1');
      assert.equal('notes' in value, false);
    }],
  ];

  for (const [argv, method, response, assertion] of cases) {
    const { io, capture } = captureIo();
    const calls = [];
    const api = stubApi(calls, { [method]: response });
    const exit = await runCli(argv, {
      io,
      configStore: configStore(),
      credentialStore: new MemoryCredentialStore([[ORIGIN, privateCredential('secret')]]),
      apiFactory: () => api,
    });
    assert.equal(exit, 0, argv.join(' '));
    assertion(parseSingleJson(capture.stdout));
    assert.equal(capture.stderr, '');
    assert.equal(calls[0].method, method);
  }
});

test('MR list 默认映射 opened，显式 all 原样传递', async () => {
  for (const [extra, expected] of [[[], 'opened'], [['--state', 'all'], 'all']]) {
    const { io } = captureIo();
    const calls = [];
    const exit = await runCli(['mr', 'list', '--project-id', '9001', ...extra], {
      io,
      configStore: configStore(),
      credentialStore: new MemoryCredentialStore([[ORIGIN, privateCredential('secret')]]),
      apiFactory: () => stubApi(calls, { listMergeRequests: [] }),
    });
    assert.equal(exit, 0);
    assert.deepEqual(calls[0].args, ['9001', expected]);
  }
});

test('评论正文和 severity 原样传递且空正文在网络前拒绝', async () => {
  const { io } = captureIo();
  const calls = [];
  await runCli([
    'mr', 'comment', 'create', '17', '--project-id', '9001',
    '--body', ' \n', '--severity', 'suggestion',
  ], {
    io,
    configStore: configStore(),
    credentialStore: new MemoryCredentialStore([[ORIGIN, privateCredential('secret')]]),
    apiFactory: () => stubApi(calls, { createMergeRequestComment: commentApiFixture }),
  });
  assert.deepEqual(calls[0].args, ['9001', '17', ' \n', 'suggestion']);

  const invalid = captureIo();
  let apiCalls = 0;
  const exit = await runCli([
    'mr', 'comment', 'create', '17', '--project-id', '9001', '--body=',
  ], {
    io: invalid.io,
    configStore: configStore(),
    credentialStore: new MemoryCredentialStore([[ORIGIN, privateCredential('secret')]]),
    apiFactory: () => { apiCalls += 1; },
  });
  assert.equal(exit, 2);
  assert.equal(apiCalls, 0);
});

test('缺少凭据时业务命令返回 AUTH_ERROR 且不创建 API client', async () => {
  const { io, capture } = captureIo();
  let apiCalls = 0;
  const exit = await runCli(['repo', 'list', '1'], {
    io,
    configStore: configStore(),
    credentialStore: new MemoryCredentialStore(),
    apiFactory: () => { apiCalls += 1; },
  });
  assert.equal(exit, 3);
  assert.equal(capture.stdout, '');
  assert.equal(parseSingleJson(capture.stderr).code, 'AUTH_ERROR');
  assert.equal(apiCalls, 0);
});

test('未达到刷新时间直接使用旧 DevUC token且不读取 DevUC 配置', async () => {
  const issuedAt = 1_000;
  const rawConfig = validConfig({ devuc: { endpoint: '', appCode: '' } });
  const store = new MemoryCredentialStore([[ORIGIN, devucCredential({
    account: 'Agent1', password: 'password', token: 'old-token', issuedAtMs: issuedAt,
  })]]);
  const contexts = [];
  const { io } = captureIo();
  const exit = await runCli(['repo', 'list', '1'], {
    io,
    configStore: configStore(rawConfig),
    credentialStore: store,
    now: () => issuedAt + DEVUC_VALIDITY_MS - DEVUC_REFRESH_LEEWAY_MS - 1,
    apiFactory: (options) => {
      contexts.push(options);
      return stubApi([], { listProjects: [] });
    },
  });
  assert.equal(exit, 0);
  assert.equal(contexts.length, 1);
  assert.equal(contexts[0].credential.token, 'old-token');
});

test('精确刷新边界先保存新 DevUC token 再发送业务请求', async () => {
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
    account: 'Agent1', password: 'password', token: 'old-token', issuedAtMs: issuedAt,
  })]]);
  const { io } = captureIo();
  let refreshCalls = 0;
  const exit = await runCli(['repo', 'list', '1'], {
    io,
    configStore: configStore(),
    credentialStore: store,
    now: () => boundary,
    apiFactory: (options) => {
      if (options.devuc) {
        return { devucLogin: async () => {
          refreshCalls += 1;
          events.push('refresh');
          return 'new-token';
        } };
      }
      assert.equal(options.credential.token, 'new-token');
      return { listProjects: async () => {
        events.push('business');
        return [];
      } };
    },
  });
  assert.equal(exit, 0);
  assert.equal(refreshCalls, 1);
  assert.deepEqual(events, ['refresh', 'save:new-token', 'business']);
  assert.equal((await store.get(ORIGIN)).issued_at_ms, boundary);
});

test('刷新或保存失败时不使用旧 token、不发送业务请求', async () => {
  for (const mode of ['refresh', 'save']) {
    const { io, capture } = captureIo();
    let businessCalls = 0;
    const base = new MemoryCredentialStore([[ORIGIN, devucCredential({
      account: 'Agent1', password: 'password', token: 'old-token', issuedAtMs: 0,
    })]]);
    const store = mode === 'save'
      ? {
          get: (...args) => base.get(...args),
          save: async () => { throw new CliError('AUTH_ERROR'); },
        }
      : base;
    const exit = await runCli(['repo', 'list', '1'], {
      io,
      configStore: configStore(),
      credentialStore: store,
      now: () => DEVUC_VALIDITY_MS,
      apiFactory: (options) => {
        if (options.devuc) return {
          devucLogin: async () => {
            if (mode === 'refresh') throw new CliError('AUTH_ERROR');
            return 'new-token';
          },
        };
        businessCalls += 1;
        return stubApi([], { listProjects: [] });
      },
    });
    assert.equal(exit, 3);
    assert.equal(parseSingleJson(capture.stderr).code, 'AUTH_ERROR');
    assert.equal(businessCalls, 0);
  }
});

test('参数、配置、HTTP、网络和写入未知错误保持 stdout/stderr 与退出码契约', async () => {
  const cases = [
    [['repo', 'list', '0'], {}, 2, 'INVALID_ARGUMENT'],
    [['repo', 'list', '1'], {
      configStore: { load: async () => { throw new CliError('CONFIG_ERROR'); } },
    }, 3, 'CONFIG_ERROR'],
    [['repo', 'list', '1'], {
      apiError: new CliError('HTTP_ERROR', { httpStatus: 403 }),
    }, 4, 'HTTP_ERROR'],
    [['repo', 'list', '1'], {
      apiError: new CliError('NETWORK_ERROR'),
    }, 8, 'NETWORK_ERROR'],
    [[
      'mr', 'comment', 'create', '17', '--project-id', '1', '--body', 'x',
    ], { apiError: new CliError('WRITE_RESULT_UNKNOWN') }, 8, 'WRITE_RESULT_UNKNOWN'],
  ];

  for (const [argv, overrides, expectedExit, expectedCode] of cases) {
    const { io, capture } = captureIo();
    const exit = await runCli(argv, {
      io,
      configStore: overrides.configStore ?? configStore(),
      credentialStore: new MemoryCredentialStore([[ORIGIN, privateCredential('secret')]]),
      apiFactory: () => new Proxy({}, {
        get: () => async () => { throw overrides.apiError; },
      }),
    });
    assert.equal(exit, expectedExit, argv.join(' '));
    assert.equal(capture.stdout, '');
    assert.equal(parseSingleJson(capture.stderr).code, expectedCode);
  }
});

test('human 输出和帮助使用简体中文且未知参数不混入 Commander 文本', async () => {
  const human = captureIo();
  const exit = await runCli(['auth', 'status', '--output', 'human'], {
    io: human.io,
    configStore: configStore(),
    credentialStore: new MemoryCredentialStore(),
  });
  assert.equal(exit, 0);
  assert.match(human.capture.stdout, /未登录/);
  assert.equal(human.capture.stderr, '');

  const help = captureIo();
  assert.equal(await runCli(['--help'], { io: help.io }), 0);
  assert.match(help.capture.stdout, /^用法:/);
  assert.match(help.capture.stdout, /命令:/);

  const unknown = captureIo();
  assert.equal(await runCli(['--unknown'], { io: unknown.io }), 2);
  assert.equal(unknown.capture.stdout, '');
  assert.deepEqual(Object.keys(parseSingleJson(unknown.capture.stderr)), ['code', 'message']);
  assert.doesNotMatch(unknown.capture.stderr, /unknown option|Usage:/i);
});

test('根命令或命令组本身返回单一 INVALID_ARGUMENT JSON', async () => {
  for (const argv of [[], ['repo'], ['mr'], ['mr', 'comment'], ['auth']]) {
    const { io, capture } = captureIo();
    const exit = await runCli(argv, { io });
    assert.equal(exit, 2);
    assert.equal(capture.stdout, '');
    assert.equal(parseSingleJson(capture.stderr).code, 'INVALID_ARGUMENT');
  }
});

test('服务端返回值和 SSH URL 用户名在 JSON 输出中保持不变', async () => {
  const { io, capture } = captureIo();
  const upstream = {
    ...repoApiFixture,
    path_with_namespace: 'prefix-private-secret-suffix',
    web_url: 'https://user:password@codehub.test/project',
    ssh_url_to_repo: 'ssh://git@codehub.test/platform/agent-tools.git',
  };
  const exit = await runCli(['repo', 'view', '9001'], {
    io,
    configStore: configStore(),
    credentialStore: new MemoryCredentialStore([[ORIGIN, privateCredential('private-secret')]]),
    apiFactory: () => stubApi([], { viewProject: upstream }),
  });
  assert.equal(exit, 0);
  const result = parseSingleJson(capture.stdout);
  assert.equal(result.full_name, 'prefix-private-secret-suffix');
  assert.equal(result.web_url, 'https://user:password@codehub.test/project');
  assert.equal(result.clone_urls.ssh, 'ssh://git@codehub.test/platform/agent-tools.git');
  assert.doesNotMatch(capture.stdout, /\[REDACTED\]/);
});

function stubApi(calls, responses) {
  return new Proxy({}, {
    get(_target, method) {
      return async (...args) => {
        calls.push({ method, args });
        const value = responses[method];
        if (value instanceof Error) throw value;
        return structuredClone(value);
      };
    },
  });
}

function failCredentialStore() {
  return {
    get: async () => { throw new Error('must not read credentials'); },
    save: async () => { throw new Error('must not save credentials'); },
    clear: async () => { throw new Error('must not clear credentials'); },
  };
}
