import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { runCli } from '../src/cli.js';
import { AUTH_TYPES } from '../src/constants.js';
import { CliError } from '../src/errors.js';
import {
  commentApiFixture,
  mergeRequestApiFixture,
  repoApiFixture,
} from '../test-support/fixtures.js';
import {
  captureIo,
  jsonResponse,
  MemoryConfigStore,
  MemoryCredentialStore,
  TEST_CONFIG,
  testEnv,
} from '../test-support/helpers.js';

async function invoke(argv, overrides = {}) {
  const capture = captureIo();
  const store =
    overrides.credentialStore ??
    new MemoryCredentialStore({
      authType: AUTH_TYPES.PRIVATE_TOKEN,
      token: 'test-token',
      source: 'credential_helper',
    });
  const code = await runCli(argv, {
    env: testEnv(overrides.env),
    io: capture.io,
    configStore: overrides.configStore ?? new MemoryConfigStore(),
    credentialStore: store,
    fetchImpl: overrides.fetchImpl,
    readStdin: overrides.readStdin,
    interactive: overrides.interactive,
    promptLogin: overrides.promptLogin,
    sleep: overrides.sleep ?? (async () => {}),
    random: () => 0,
    stdoutIsTTY: overrides.stdoutIsTTY,
    stderrIsTTY: overrides.stderrIsTTY,
    columns: overrides.columns,
    now: overrides.now,
  });

  return {
    code,
    stdout: capture.stdout(),
    stderr: capture.stderr(),
    store,
  };
}

test('version 是无网络、无凭据的有效 v1 成功信封', async () => {
  const result = await invoke(['version', '--request-id', 'test-version'], {
    credentialStore: {
      get: async () => {
        throw new Error('不应读取凭据');
      },
    },
    fetchImpl: async () => {
      throw new Error('不应访问网络');
    },
  });
  const envelope = JSON.parse(result.stdout);

  assert.equal(result.code, 0);
  assert.equal(result.stderr, '');
  assert.equal(envelope.schema_version, 'codehub.cli/v1');
  assert.equal(envelope.command, 'version');
  assert.equal(envelope.request_id, 'test-version');
  assert.equal(envelope.data.protocol_version, 'codehub.cli/v1');
});

test('capabilities 准确声明写入限制', async () => {
  const result = await invoke(['capabilities']);
  const data = JSON.parse(result.stdout).data;

  assert.equal(data.pagination_guaranteed, false);
  assert.equal(data.conditional_write, false);
  assert.equal(data.idempotent_write, false);
  assert.equal(data.write_requires_confirmation, true);
  assert.equal(data.write_auto_retry, false);
});

test('config init 不读取已有配置、凭据或网络且默认输出 human', async () => {
  const configStore = new MemoryConfigStore();
  let credentialReads = 0;
  let requests = 0;
  const result = await invoke(['config', 'init'], {
    configStore,
    credentialStore: {
      async get() {
        credentialReads += 1;
        return null;
      },
    },
    fetchImpl: async () => {
      requests += 1;
      return jsonResponse({});
    },
  });

  assert.equal(result.code, 0);
  assert.equal(configStore.loads, 0);
  assert.equal(configStore.initialisations, 1);
  assert.equal(credentialReads, 0);
  assert.equal(requests, 0);
  assert.match(result.stdout, /配置初始化完成/);
  assert.match(result.stdout, /config\.json/);
  assert.doesNotMatch(result.stdout, /app-code|w3tokens|api\/v4/);
});

test('缺少用户配置时业务命令先返回 CONFIG_REQUIRED', async () => {
  let credentialReads = 0;
  let requests = 0;
  const result = await invoke(['repo', 'view', '42'], {
    configStore: {
      async load() {
        throw new CliError(
          'CONFIG_REQUIRED',
          '尚未初始化 CodeHub 配置，请先执行 codehub config init。',
        );
      },
    },
    credentialStore: {
      async get() {
        credentialReads += 1;
        return null;
      },
    },
    fetchImpl: async () => {
      requests += 1;
      return jsonResponse({});
    },
  });
  const envelope = JSON.parse(result.stderr);

  assert.equal(result.code, 3);
  assert.equal(envelope.error.code, 'CONFIG_REQUIRED');
  assert.equal(credentialReads, 0);
  assert.equal(requests, 0);
});

test('private token 交互登录将凭据保存到 Credential Helper', async () => {
  const store = new MemoryCredentialStore();
  const result = await invoke(['auth', 'login'], {
    credentialStore: store,
    interactive: true,
    promptLogin: async () => ({
      method: AUTH_TYPES.PRIVATE_TOKEN,
      token: 'secret-token',
    }),
  });

  assert.equal(result.code, 0);
  assert.equal(store.saved[0].token, 'secret-token');
  assert.match(result.stdout, /登录成功/);
  assert.doesNotMatch(result.stdout, /secret-token/);
});

test('DevUC 登录使用独立 AppCode，只保存 newToken 而不保存密码', async () => {
  const store = new MemoryCredentialStore();
  let request;
  const result = await invoke(['auth', 'login'], {
    credentialStore: store,
    interactive: true,
    promptLogin: async () => ({
      method: 'devuc',
      account: 'agent123',
      password: 'password-value',
    }),
    fetchImpl: async (url, init) => {
      request = { url: String(url), init };
      return jsonResponse({
        status: 'ok',
        result: { newToken: 'new-auth-token', token: 'ignored-token' },
      });
    },
  });

  assert.equal(result.code, 0);
  assert.equal(request.url, TEST_CONFIG.devuc.endpoint);
  assert.equal(
    request.init.headers['X-Apig-AppCode'],
    TEST_CONFIG.devuc.appCode,
  );
  assert.equal(request.init.headers['private-token'], undefined);
  assert.deepEqual(JSON.parse(request.init.body), {
    account: 'agent123',
    password: 'password-value',
  });
  assert.deepEqual(store.saved, [
    { authType: AUTH_TYPES.X_AUTH_TOKEN, token: 'new-auth-token' },
  ]);
  assert.doesNotMatch(JSON.stringify(store.saved), /password-value/);
});

test('DevUC 成功状态缺少 newToken 时返回响应协议错误', async () => {
  const result = await invoke(['auth', 'login', '--output', 'json'], {
    credentialStore: new MemoryCredentialStore(),
    interactive: true,
    promptLogin: async () => ({
      method: 'devuc',
      account: 'agent123',
      password: 'password-value',
    }),
    fetchImpl: async () => jsonResponse({ status: 'ok', result: {} }),
  });

  assert.equal(result.code, 9);
  assert.equal(JSON.parse(result.stderr).error.code, 'RESPONSE_SCHEMA_ERROR');
  assert.doesNotMatch(result.stderr, /password-value/);
});

test('非 TTY 环境不能执行登录', async () => {
  let prompts = 0;
  const result = await invoke(['auth', 'login', '--output', 'json'], {
    credentialStore: new MemoryCredentialStore(),
    interactive: false,
    promptLogin: async () => {
      prompts += 1;
      return {};
    },
  });
  const envelope = JSON.parse(result.stderr);

  assert.equal(result.code, 2);
  assert.equal(result.stdout, '');
  assert.equal(prompts, 0);
  assert.equal(envelope.error.code, 'INVALID_ARGUMENT');
  assert.match(envelope.error.message, /交互式终端/);
});

test('auth login 拒绝 --no-input 和旧的非交互选项', async () => {
  const noInput = await invoke(
    ['auth', 'login', '--no-input', '--output', 'json'],
    { interactive: true, promptLogin: async () => ({}) },
  );

  assert.equal(noInput.code, 2);
  assert.equal(JSON.parse(noInput.stderr).error.code, 'INVALID_ARGUMENT');
  assert.match(JSON.parse(noInput.stderr).error.message, /--no-input/);

  for (const legacyArguments of [
    ['--with-token'],
    ['--devuc'],
    ['--account', 'agent123'],
    ['--password-stdin'],
  ]) {
    const legacy = await invoke(
      ['auth', 'login', ...legacyArguments, '--output', 'json'],
      { interactive: true, promptLogin: async () => ({}) },
    );
    assert.equal(legacy.code, 2, legacyArguments.join(' '));
    assert.equal(
      JSON.parse(legacy.stderr).error.code,
      'INVALID_ARGUMENT',
      legacyArguments.join(' '),
    );
  }
});

test('人类按 Ctrl+C 取消登录时返回 130', async () => {
  const result = await invoke(['auth', 'login', '--output', 'json'], {
    interactive: true,
    promptLogin: async () => {
      throw new CliError('CANCELLED', '用户取消了登录。');
    },
  });

  assert.equal(result.code, 130);
  assert.equal(result.stdout, '');
  assert.equal(JSON.parse(result.stderr).error.code, 'CANCELLED');
});

test('auth status 只检查 Credential Helper，不访问网络', async () => {
  let helperReads = 0;
  let requests = 0;
  const credentialStore = {
    async get() {
      helperReads += 1;
      return {
        authType: AUTH_TYPES.X_AUTH_TOKEN,
        token: 'stored-status-token',
        source: 'credential_helper',
      };
    },
  };
  const result = await invoke(['auth', 'status'], {
    credentialStore,
    fetchImpl: async () => {
      requests += 1;
      return jsonResponse({});
    },
  });
  const envelope = JSON.parse(result.stdout);

  assert.equal(result.code, 0);
  assert.equal(helperReads, 1);
  assert.equal(requests, 0);
  assert.equal(envelope.data.authentication_type, 'x_auth_token');
  assert.equal(envelope.data.credential_source, 'credential_helper');
  assert.equal('verified' in envelope.data, false);
  assert.deepEqual(envelope.warnings, []);
  assert.doesNotMatch(result.stdout, /stored-status-token/);

  const human = await invoke(['auth', 'status', '--output', 'human'], {
    credentialStore,
  });
  assert.equal(human.code, 0);
  assert.equal(helperReads, 2);
  assert.doesNotMatch(human.stdout, /远端有效性|未验证/);
});

test('token 环境变量不作为认证凭据', async () => {
  const result = await invoke(['auth', 'status'], {
    env: {
      CODEHUB_PRIVATE_TOKEN: 'ignored-private-token',
      CODEHUB_AUTH_TOKEN: 'ignored-auth-token',
    },
    credentialStore: new MemoryCredentialStore(),
  });
  const envelope = JSON.parse(result.stdout);

  assert.equal(result.code, 0);
  assert.equal(envelope.data.configured, false);
  assert.equal(envelope.data.credential_source, null);
  assert.deepEqual(envelope.warnings, []);
  assert.doesNotMatch(result.stdout, /ignored/);
});

test('Agent 未登录时业务命令返回 AUTH_REQUIRED 且不访问网络', async () => {
  let requests = 0;
  const result = await invoke(['repo', 'view', '42'], {
    env: { CODEHUB_PRIVATE_TOKEN: 'ignored-token' },
    credentialStore: new MemoryCredentialStore(),
    fetchImpl: async () => {
      requests += 1;
      return jsonResponse({});
    },
  });
  const envelope = JSON.parse(result.stderr);

  assert.equal(result.code, 3);
  assert.equal(result.stdout, '');
  assert.equal(requests, 0);
  assert.equal(envelope.error.code, 'AUTH_REQUIRED');
  assert.match(envelope.error.message, /codehub auth login/);
  assert.doesNotMatch(result.stderr, /ignored-token/);
});

test('auth logout 只删除 Credential Helper 凭据', async () => {
  const store = new MemoryCredentialStore();
  const result = await invoke(['auth', 'logout'], {
    credentialStore: store,
  });
  const envelope = JSON.parse(result.stdout);

  assert.equal(result.code, 0);
  assert.equal(store.cleared, true);
  assert.equal(envelope.data.credential_helper_cleared, true);
  assert.deepEqual(envelope.warnings, []);
});

test('repo list 映射 URL、互斥认证 Header、ID 字符串与分页 warning', async () => {
  let request;
  const result = await invoke(['repo', 'list', '42'], {
    env: { CODEHUB_PRIVATE_TOKEN: 'ignored-environment-token' },
    fetchImpl: async (url, init) => {
      request = { url: String(url), init };
      return jsonResponse([repoApiFixture]);
    },
  });
  const envelope = JSON.parse(result.stdout);

  assert.equal(result.code, 0);
  assert.equal(
    request.url,
    `${TEST_CONFIG.codehub.endpoint}/groups/42/projects`,
  );
  assert.equal(request.init.headers['private-token'], 'test-token');
  assert.equal(request.init.headers['X-Auth-token'], undefined);
  assert.equal(
    request.init.headers['X-Apig-AppCode'],
    TEST_CONFIG.codehub.appCode,
  );
  assert.deepEqual(envelope.data, [
    {
      repo_id: '9001',
      full_name: 'platform/agent-tools',
      clone_urls: {
        ssh: 'git@codehub.test:platform/agent-tools.git',
        https: 'https://codehub.test/platform/agent-tools.git',
      },
      archived: false,
      updated_at: '2026-07-31T08:00:00Z',
    },
  ]);
  assert.doesNotMatch(result.stdout, /reviewer|member_count|unknown_server_field/);
  assert.equal(envelope.warnings[0].code, 'PARTIAL_LIST_POSSIBLE');
});

test('服务端响应即使回显凭据或含凭据 URL，也不会泄漏到输出', async () => {
  const result = await invoke(['repo', 'view', '42'], {
    credentialStore: new MemoryCredentialStore({
      authType: AUTH_TYPES.PRIVATE_TOKEN,
      token: 'stored-secret-token',
      source: 'credential_helper',
    }),
    fetchImpl: async () =>
      jsonResponse({
        id: 42,
        echoed: 'stored-secret-token',
        path_with_namespace: 'group/repo',
        http_url_to_repo:
          'https://oauth2:another-secret@codehub.test/group/repo.git',
      }),
  });
  const data = JSON.parse(result.stdout).data;

  assert.equal('echoed' in data, false);
  assert.equal(
    data.clone_urls.https,
    'https://codehub.test/group/repo.git',
  );
  assert.doesNotMatch(result.stdout, /stored-secret-token|another-secret/);
});

test('mr list 默认查询 opened，显式 --state all 仍可查询历史记录', async () => {
  const urls = [];
  const result = await invoke(['mr', 'list', '-R', '77'], {
    fetchImpl: async (input) => {
      urls.push(String(input));
      return jsonResponse([{ ...mergeRequestApiFixture, project_id: 77 }]);
    },
  });
  const all = await invoke(['mr', 'list', '-R', '77', '--state', 'all'], {
    fetchImpl: async (input) => {
      urls.push(String(input));
      return jsonResponse([]);
    },
  });

  assert.equal(result.code, 0);
  assert.equal(all.code, 0);
  assert.equal(
    urls[0],
    `${TEST_CONFIG.codehub.endpoint}/projects/77/isource/merge_requests?state=opened`,
  );
  assert.equal(
    urls[1],
    `${TEST_CONFIG.codehub.endpoint}/projects/77/isource/merge_requests?state=all`,
  );
  assert.equal(JSON.parse(result.stdout).data[0].repo_id, '77');
  assert.doesNotMatch(result.stdout, /reviewer|assignee/);
});

test('Project、MR 详情与 Commit 的 API path 完整映射', async () => {
  const cases = [
    {
      argv: ['repo', 'view', '12'],
      expected: `${TEST_CONFIG.codehub.endpoint}/projects/12`,
      response: { id: 12, name: 'project' },
    },
    {
      argv: ['mr', 'view', '7', '-R', '12'],
      expected:
        `${TEST_CONFIG.codehub.endpoint}/projects/12/isource/merge_requests/7`,
      response: { id: 90, iid: 7, project_id: 12 },
    },
    {
      argv: ['mr', 'commits', '7', '-R', '12'],
      expected:
        `${TEST_CONFIG.codehub.endpoint}/projects/12/merge_requests/7/commits`,
      response: [{ id: 'abc123', parent_ids: ['def456'] }],
    },
  ];

  for (const item of cases) {
    let actual;
    const result = await invoke(item.argv, {
      fetchImpl: async (url) => {
        actual = String(url);
        return jsonResponse(item.response);
      },
    });
    assert.equal(result.code, 0);
    assert.equal(actual, item.expected);
  }
});

test('JSON 失败时 stdout 为空且 stderr 只有一个错误对象', async () => {
  const result = await invoke(['mr', 'view', '2']);
  const error = JSON.parse(result.stderr);

  assert.equal(result.code, 2);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, `${JSON.stringify(error, null, 2)}\n`);
  assert.doesNotMatch(result.stderr, /\u001b\[/i);
  assert.equal(error.command, 'mr.view');
  assert.equal(error.error.code, 'INVALID_ARGUMENT');
});

test('只有命令组时不会把 Commander 帮助混入 JSON 错误', async () => {
  const result = await invoke(['mr']);

  assert.equal(result.code, 2);
  assert.equal(result.stdout, '');
  const error = JSON.parse(result.stderr);
  assert.equal(result.stderr, `${JSON.stringify(error, null, 2)}\n`);
  assert.equal(error.error.code, 'INVALID_ARGUMENT');
});

test('重复 body-file 在本地拒绝且不读取文件', async () => {
  const result = await invoke([
    'mr',
    'comment',
    'create',
    '9',
    '-R',
    '2',
    '--body-file',
    'one.md',
    '--body-file',
    'two.md',
    '--confirm-write',
  ]);

  assert.equal(result.code, 2);
  assert.equal(result.stdout, '');
  assert.equal(JSON.parse(result.stderr).error.code, 'INVALID_ARGUMENT');
});

test('评论缺少 confirm-write 时在读取正文和网络之前拒绝', async () => {
  let reads = 0;
  let requests = 0;
  const result = await invoke(
    ['mr', 'comment', 'create', '9', '-R', '2', '--body-file', '-'],
    {
      readStdin: async () => {
        reads += 1;
        return 'body';
      },
      fetchImpl: async () => {
        requests += 1;
        return jsonResponse({});
      },
    },
  );

  assert.equal(result.code, 4);
  assert.equal(JSON.parse(result.stderr).error.code, 'POLICY_DENIED');
  assert.equal(reads, 0);
  assert.equal(requests, 0);
});

test('非法 severity 在读取正文和网络之前拒绝', async () => {
  let reads = 0;
  let requests = 0;
  const result = await invoke(
    [
      'mr',
      'comment',
      'create',
      '9',
      '-R',
      '2',
      '--body-file',
      '-',
      '--severity',
      'critical',
      '--confirm-write',
    ],
    {
      readStdin: async () => {
        reads += 1;
        return 'body';
      },
      fetchImpl: async () => {
        requests += 1;
        return jsonResponse({});
      },
    },
  );

  assert.equal(result.code, 2);
  assert.equal(JSON.parse(result.stderr).error.code, 'INVALID_ARGUMENT');
  assert.equal(reads, 0);
  assert.equal(requests, 0);
});

test('评论 dry-run 不发请求、不回显正文并报告 UTF-8 字节数', async () => {
  let requests = 0;
  const body = '重要：不要回显 🚀';
  const result = await invoke(
    [
      'mr',
      'comment',
      'create',
      '9',
      '-R',
      '2',
      '--body-file',
      '-',
      '--severity',
      'major',
      '--confirm-write',
      '--dry-run',
    ],
    {
      readStdin: async () => body,
      fetchImpl: async () => {
        requests += 1;
        return jsonResponse({});
      },
    },
  );
  const data = JSON.parse(result.stdout).data;

  assert.equal(result.code, 0);
  assert.equal(requests, 0);
  assert.equal(data.repo_id, '2');
  assert.equal(data.mr_iid, '9');
  assert.equal(data.body_utf8_bytes, Buffer.byteLength(body));
  assert.equal(data.severity, 'major');
  assert.equal('project_id' in data, false);
  assert.equal('merge_request_iid' in data, false);
  assert.doesNotMatch(result.stdout, /不要回显/);
});

test('评论 POST 正文保持原样，成功结果包含安全 warning', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codehub-cli-'));
  const path = join(directory, 'review.md');
  const body = '  **review**\n$(echo untouched)\n';
  await writeFile(path, body, 'utf8');
  let request;

  const result = await invoke(
    [
      'mr',
      'comment',
      'create',
      '9',
      '-R',
      '2',
      '--body-file',
      path,
      '--confirm-write',
    ],
    {
      fetchImpl: async (url, init) => {
        request = { url: String(url), init };
        return jsonResponse({
          ...commentApiFixture,
          project_id: 2,
          severity: 'suggestion',
        });
      },
    },
  );
  const envelope = JSON.parse(result.stdout);

  assert.equal(result.code, 0);
  assert.equal(request.init.method, 'POST');
  assert.deepEqual(JSON.parse(request.init.body), {
    body,
    severity: 'suggestion',
  });
  assert.deepEqual(envelope.data, {
    comment_id: 'discussion-1',
    repo_id: '2',
    mr_iid: '9',
    severity: 'suggestion',
    resolved: false,
    web_url:
      'https://codehub.test/platform/agent-tools/-/merge_requests/17#note_1',
  });
  assert.doesNotMatch(result.stdout, /notes|reviewer|assignee|proposer/);
  assert.equal(envelope.warnings[0].code, 'UNSAFE_WRITE_GUARANTEES');
});

test('响应结构错误不会把原始响应或凭据写入输出', async () => {
  const result = await invoke(['repo', 'view', '2'], {
    fetchImpl: async () =>
      jsonResponse({ secret_server_field: 'never-print-response' }, {
        status: 200,
      }),
  });

  // Project 详情只要求对象；改用数组触发 schema error。
  const invalid = await invoke(['repo', 'view', '2'], {
    fetchImpl: async () => jsonResponse([]),
  });

  assert.equal(result.code, 0);
  assert.equal(invalid.code, 9);
  assert.equal(JSON.parse(invalid.stderr).error.code, 'RESPONSE_SCHEMA_ERROR');
  assert.doesNotMatch(invalid.stderr, /never-print/);
});

test('human 模式逐次提示 GET 重试且最终输出可读结果', async () => {
  let calls = 0;
  const result = await invoke(
    ['repo', 'view', '2', '--output', 'human'],
    {
      fetchImpl: async () => {
        calls += 1;
        return calls === 1
          ? jsonResponse({}, { status: 503 })
          : jsonResponse({ id: 2, name: 'project' });
      },
    },
  );

  assert.equal(result.code, 0);
  assert.match(result.stderr, /读取请求重试 1\/2/);
  assert.match(result.stdout, /project/);
  assert.match(result.stdout, /仓库 ID\s+2/);
  assert.match(result.stdout, /REQUEST_RETRIED/);
});
