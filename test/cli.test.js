import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { runCli } from '../src/cli.js';
import { AUTH_TYPES } from '../src/constants.js';
import {
  captureIo,
  jsonResponse,
  MemoryCredentialStore,
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
    credentialStore: store,
    fetchImpl: overrides.fetchImpl,
    readStdin: overrides.readStdin,
    readHidden: overrides.readHidden,
    sleep: overrides.sleep ?? (async () => {}),
    random: () => 0,
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

test('private token 登录只移除一个末尾换行并保存到 Credential Helper', async () => {
  const store = new MemoryCredentialStore();
  const result = await invoke(['auth', 'login', '--with-token'], {
    credentialStore: store,
    readStdin: async () => ' secret-token \n',
  });

  assert.equal(result.code, 0);
  assert.equal(store.saved[0].token, ' secret-token ');
  assert.doesNotMatch(result.stdout, /secret-token/);
});

test('DevUC 登录使用独立 AppCode，只保存 newToken 而不保存密码', async () => {
  const store = new MemoryCredentialStore();
  let request;
  const result = await invoke(
    [
      'auth',
      'login',
      '--devuc',
      '--account',
      'agent123',
      '--password-stdin',
      '--no-input',
    ],
    {
      credentialStore: store,
      readStdin: async () => 'password-value\n',
      fetchImpl: async (url, init) => {
        request = { url: String(url), init };
        return jsonResponse({
          status: 'ok',
          result: { newToken: 'new-auth-token', token: 'ignored-token' },
        });
      },
    },
  );

  assert.equal(result.code, 0);
  assert.equal(request.url, 'https://devuc.test/token');
  assert.equal(request.init.headers['X-Apig-AppCode'], 'devuc-app-code');
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
  const result = await invoke(
    [
      'auth',
      'login',
      '--devuc',
      '--account',
      'agent123',
      '--password-stdin',
      '--no-input',
    ],
    {
      credentialStore: new MemoryCredentialStore(),
      readStdin: async () => 'password-value',
      fetchImpl: async () => jsonResponse({ status: 'ok', result: {} }),
    },
  );

  assert.equal(result.code, 9);
  assert.equal(JSON.parse(result.stderr).error.code, 'RESPONSE_SCHEMA_ERROR');
  assert.doesNotMatch(result.stderr, /password-value/);
});

test('auth status 只检查环境变量凭据，不访问网络或 Helper', async () => {
  let helperReads = 0;
  let requests = 0;
  const result = await invoke(['auth', 'status'], {
    env: { CODEHUB_AUTH_TOKEN: 'status-token' },
    credentialStore: {
      async get() {
        helperReads += 1;
        return null;
      },
    },
    fetchImpl: async () => {
      requests += 1;
      return jsonResponse({});
    },
  });
  const envelope = JSON.parse(result.stdout);

  assert.equal(result.code, 0);
  assert.equal(helperReads, 0);
  assert.equal(requests, 0);
  assert.equal(envelope.data.authentication_type, 'x_auth_token');
  assert.equal(envelope.data.verified, false);
  assert.equal(envelope.warnings[0].code, 'CREDENTIAL_NOT_VERIFIED');
  assert.doesNotMatch(result.stdout, /status-token/);
});

test('auth logout 删除持久凭据并提示环境变量仍会生效', async () => {
  const store = new MemoryCredentialStore();
  const result = await invoke(['auth', 'logout'], {
    env: { CODEHUB_PRIVATE_TOKEN: 'active-token' },
    credentialStore: store,
  });
  const envelope = JSON.parse(result.stdout);

  assert.equal(result.code, 0);
  assert.equal(store.cleared, true);
  assert.equal(envelope.data.environment_credential_active, true);
  assert.equal(envelope.warnings[0].code, 'ENV_CREDENTIAL_STILL_ACTIVE');
  assert.doesNotMatch(result.stdout, /active-token/);
});

test('repo list 映射 URL、互斥认证 Header、ID 字符串与分页 warning', async () => {
  let request;
  const result = await invoke(['repo', 'list', '42'], {
    env: { CODEHUB_PRIVATE_TOKEN: 'environment-token' },
    fetchImpl: async (url, init) => {
      request = { url: String(url), init };
      return jsonResponse([
        {
          id: 9001,
          name: 'agent-tools',
          namespace: { id: 8, name: 'platform' },
        },
      ]);
    },
  });
  const envelope = JSON.parse(result.stdout);

  assert.equal(result.code, 0);
  assert.equal(
    request.url,
    'https://codehub.test/api/v4/groups/42/projects',
  );
  assert.equal(request.init.headers['private-token'], 'environment-token');
  assert.equal(request.init.headers['X-Auth-token'], undefined);
  assert.equal(envelope.data[0].id, '9001');
  assert.equal(envelope.data[0].namespace.id, '8');
  assert.equal(envelope.warnings[0].code, 'PARTIAL_LIST_POSSIBLE');
});

test('服务端响应即使回显凭据或含凭据 URL，也不会泄漏到输出', async () => {
  const result = await invoke(['repo', 'view', '42'], {
    env: { CODEHUB_PRIVATE_TOKEN: 'environment-token' },
    fetchImpl: async () =>
      jsonResponse({
        id: 42,
        echoed: 'environment-token',
        http_url_to_repo:
          'https://oauth2:another-secret@codehub.test/group/repo.git',
      }),
  });
  const data = JSON.parse(result.stdout).data;

  assert.equal(data.echoed, '[REDACTED]');
  assert.equal(
    data.http_url_to_repo,
    'https://codehub.test/group/repo.git',
  );
  assert.doesNotMatch(result.stdout, /environment-token|another-secret/);
});

test('mr list 支持命令后的全局 -R，并把 open 映射为 opened', async () => {
  let url;
  const result = await invoke(['mr', 'list', '-R', '77', '--state', 'open'], {
    fetchImpl: async (input) => {
      url = String(input);
      return jsonResponse([]);
    },
  });

  assert.equal(result.code, 0);
  assert.equal(
    url,
    'https://codehub.test/api/v4/projects/77/isource/merge_requests?state=opened',
  );
});

test('Project、MR 详情与 Commit 的 API path 完整映射', async () => {
  const cases = [
    {
      argv: ['repo', 'view', '12'],
      expected: 'https://codehub.test/api/v4/projects/12',
      response: { id: 12, name: 'project' },
    },
    {
      argv: ['mr', 'view', '7', '-R', '12'],
      expected:
        'https://codehub.test/api/v4/projects/12/isource/merge_requests/7',
      response: { id: 90, iid: 7, project_id: 12 },
    },
    {
      argv: ['mr', 'commits', '7', '-R', '12'],
      expected:
        'https://codehub.test/api/v4/projects/12/merge_requests/7/commits',
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
  assert.equal(result.stderr.trim().split('\n').length, 1);
  assert.equal(error.command, 'mr.view');
  assert.equal(error.error.code, 'INVALID_ARGUMENT');
});

test('只有命令组时不会把 Commander 帮助混入 JSON 错误', async () => {
  const result = await invoke(['mr']);

  assert.equal(result.code, 2);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr.trim().split('\n').length, 1);
  assert.equal(JSON.parse(result.stderr).error.code, 'INVALID_ARGUMENT');
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
  assert.equal(data.body_utf8_bytes, Buffer.byteLength(body));
  assert.equal(data.severity, 'major');
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
          id: 'discussion-1',
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
  assert.equal(envelope.data.project_id, '2');
  assert.equal(envelope.warnings[0].code, 'UNSAFE_WRITE_GUARANTEES');
});

test('响应结构错误不会把原始响应或凭据写入输出', async () => {
  const result = await invoke(['repo', 'view', '2'], {
    env: { CODEHUB_PRIVATE_TOKEN: 'never-print-this' },
    fetchImpl: async () =>
      jsonResponse({ secret_server_field: 'never-print-response' }, {
        status: 200,
      }),
  });

  // Project 详情只要求对象；改用数组触发 schema error。
  const invalid = await invoke(['repo', 'view', '2'], {
    env: { CODEHUB_PRIVATE_TOKEN: 'never-print-this' },
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
  assert.match(result.stdout, /name: project/);
  assert.match(result.stdout, /REQUEST_RETRIED/);
});
