import assert from 'node:assert/strict';
import test from 'node:test';
import { runCli } from '../src/cli.js';
import {
  MemoryCredentialStore,
  devucCredential,
  privateCredential,
} from '../src/credentials.js';
import { CliError } from '../src/errors.js';
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
    [['repo', 'list', '8'], 'projects.list', [{ repo_id: '9001' }], (value) => {
      assert.equal(Array.isArray(value), true);
      assert.equal(value[0].repo_id, '9001');
    }],
    [['repo', 'view', '9001'], 'projects.view', { default_branch: 'main' }, (value) => {
      assert.equal(value.default_branch, 'main');
    }],
    [['mr', 'list', '--project-id', '9001'], 'mergeRequests.list', [{ iid: '17' }], (value) => {
      assert.equal(value[0].iid, '17');
    }],
    [['mr', 'view', '17', '--project-id', '9001'], 'mergeRequests.view', {
      changes: { files: 12, additions: 83, deletions: 21 },
    }, (value) => {
      assert.deepEqual(value.changes, { files: 12, additions: 83, deletions: 21 });
    }],
    [['mr', 'commits', '17', '--project-id', '9001'], 'mergeRequests.commits', [{
      sha: '0123456789abcdef0123456789abcdef01234567',
    }], (value) => {
      assert.equal(value[0].sha, '0123456789abcdef0123456789abcdef01234567');
    }],
    [[
      'mr', 'comment', 'create', '17', '--project-id', '9001',
      '--body', '保持原样\n$()', '--severity', 'major',
    ], 'mergeRequests.createComment', { comment_id: 'discussion-1' }, (value) => {
      assert.equal(value.comment_id, 'discussion-1');
    }],
  ];

  for (const [argv, method, response, assertion] of cases) {
    const { io, capture } = captureIo();
    const calls = [];
    const operations = stubOperations(calls, { [method]: response });
    const exit = await runCli(argv, {
      io,
      configStore: configStore(),
      credentialStore: new MemoryCredentialStore([[ORIGIN, privateCredential('secret')]]),
      apiFactory: () => ({}),
      operationsFactory: () => operations,
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
      apiFactory: () => ({}),
      operationsFactory: () => stubOperations(calls, { 'mergeRequests.list': [] }),
    });
    assert.equal(exit, 0);
    assert.deepEqual(calls[0].args, [{ projectId: '9001', state: expected }]);
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
    apiFactory: () => ({}),
    operationsFactory: () => stubOperations(calls, {
      'mergeRequests.createComment': { comment_id: 'discussion-1' },
    }),
  });
  assert.deepEqual(calls[0].args, [{
    projectId: '9001',
    iid: '17',
    body: ' \n',
    severity: 'suggestion',
  }]);

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
      apiFactory: () => ({}),
      operationsFactory: () => failingOperations(overrides.apiError),
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

test('领域操作返回值和 SSH URL 用户名在 JSON 输出中保持不变', async () => {
  const { io, capture } = captureIo();
  const resultFromOperations = {
    repo_id: '9001',
    full_name: 'prefix-private-secret-suffix',
    default_branch: 'main',
    web_url: 'https://user:password@codehub.test/project',
    clone_urls: {
      ssh: 'ssh://git@codehub.test/platform/agent-tools.git',
      https: 'https://codehub.test/platform/agent-tools.git',
    },
  };
  const exit = await runCli(['repo', 'view', '9001'], {
    io,
    configStore: configStore(),
    credentialStore: new MemoryCredentialStore([[ORIGIN, privateCredential('private-secret')]]),
    apiFactory: () => ({}),
    operationsFactory: () => stubOperations([], { 'projects.view': resultFromOperations }),
  });
  assert.equal(exit, 0);
  const result = parseSingleJson(capture.stdout);
  assert.equal(result.full_name, 'prefix-private-secret-suffix');
  assert.equal(result.web_url, 'https://user:password@codehub.test/project');
  assert.equal(result.clone_urls.ssh, 'ssh://git@codehub.test/platform/agent-tools.git');
  assert.doesNotMatch(capture.stdout, /\[REDACTED\]/);
});

function stubOperations(calls, responses) {
  const operation = (method) => async (...args) => {
    calls.push({ method, args });
    const value = responses[method];
    if (value instanceof Error) throw value;
    return structuredClone(value);
  };
  return {
    projects: {
      list: operation('projects.list'),
      view: operation('projects.view'),
    },
    mergeRequests: {
      list: operation('mergeRequests.list'),
      view: operation('mergeRequests.view'),
      commits: operation('mergeRequests.commits'),
      createComment: operation('mergeRequests.createComment'),
    },
  };
}

function failingOperations(error) {
  const failure = async () => { throw error; };
  return {
    projects: { list: failure, view: failure },
    mergeRequests: {
      list: failure,
      view: failure,
      commits: failure,
      createComment: failure,
    },
  };
}

function failCredentialStore() {
  return {
    get: async () => { throw new Error('must not read credentials'); },
    save: async () => { throw new Error('must not save credentials'); },
    clear: async () => { throw new Error('must not clear credentials'); },
  };
}
