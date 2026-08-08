import assert from 'node:assert/strict';
import test from 'node:test';
import { runCli } from '../src/cli.js';
import { captureIo, testEnv } from '../test-support/helpers.js';

async function invoke(argv, overrides = {}) {
  const capture = captureIo();
  const calls = {
    configLoad: 0,
    configInit: 0,
    credentialGet: 0,
    credentialSave: 0,
    credentialClear: 0,
    fetch: 0,
  };
  const code = await runCli(argv, {
    env: testEnv(),
    io: capture.io,
    configStore: {
      async load() {
        calls.configLoad += 1;
        throw new Error('仿真模式不应读取真实配置');
      },
      async init() {
        calls.configInit += 1;
        throw new Error('仿真模式不应初始化真实配置');
      },
    },
    credentialStore: {
      async get() {
        calls.credentialGet += 1;
        throw new Error('仿真模式不应读取真实凭据');
      },
      async save() {
        calls.credentialSave += 1;
        throw new Error('仿真模式不应保存真实凭据');
      },
      async clear() {
        calls.credentialClear += 1;
        throw new Error('仿真模式不应删除真实凭据');
      },
    },
    fetchImpl: async () => {
      calls.fetch += 1;
      throw new Error('仿真模式不应访问网络');
    },
    readStdin: overrides.readStdin,
    interactive: overrides.interactive ?? false,
    promptLogin: async () => {
      throw new Error('仿真模式不应显示登录提示');
    },
    now: () => new Date('2026-08-07T00:00:00Z'),
  });

  return {
    code,
    stdout: capture.stdout(),
    stderr: capture.stderr(),
    calls,
  };
}

function assertOffline(calls) {
  assert.deepEqual(calls, {
    configLoad: 0,
    configInit: 0,
    credentialGet: 0,
    credentialSave: 0,
    credentialClear: 0,
    fetch: 0,
  });
}

function parseSuccess(result) {
  assert.equal(result.code, 0);
  assert.equal(result.stderr, '');
  const envelope = JSON.parse(result.stdout);
  assert.equal(envelope.warnings[0].code, 'SIMULATION_MODE');
  assertOffline(result.calls);
  return envelope;
}

test('repo 仿真返回确定性数据并保留调用方的 Project ID', async () => {
  const list = parseSuccess(
    await invoke(['repo', 'list', '1', '--simulate', '--request-id', 'sim.repo.list']),
  );
  const view = parseSuccess(
    await invoke(['--simulate', 'repo', 'view', '12345']),
  );

  assert.equal(list.request_id, 'sim.repo.list');
  assert.deepEqual(
    list.data.map((repository) => repository.repo_id),
    ['9001', '9002'],
  );
  assert.equal(list.data[1].archived, true);
  assert.equal(list.warnings[1].code, 'PARTIAL_LIST_POSSIBLE');
  assert.equal(view.data.repo_id, '12345');
  assert.equal(view.data.full_name, 'reviewx/project-12345');
  assert.match(view.data.web_url, /^https:\/\/codehub\.simulation\.invalid\//);
});

test('MR 仿真支持状态过滤、详情和提交列表', async () => {
  const merged = parseSuccess(
    await invoke(['mr', 'list', '-R', '9001', '--state', 'merged', '--simulate']),
  );
  const detail = parseSuccess(
    await invoke(['mr', 'view', '27', '-R', '8123', '--simulate']),
  );
  const commits = parseSuccess(
    await invoke(['mr', 'commits', '27', '-R', '8123', '--simulate']),
  );

  assert.equal(merged.data.length, 1);
  assert.equal(merged.data[0].state, 'merged');
  assert.equal(detail.data.repo_id, '8123');
  assert.equal(detail.data.iid, '27');
  assert.deepEqual(detail.data.labels, ['simulation', 'review-ready']);
  assert.equal(commits.data.length, 2);
  assert.equal(commits.data[1].parent_shas[0], commits.data[0].sha);
});

test('评论仿真仍执行写入确认、正文和 severity 校验但不产生外部写入', async () => {
  const denied = await invoke(
    [
      'mr',
      'comment',
      'create',
      '17',
      '-R',
      '9001',
      '--body-file',
      '-',
      '--simulate',
    ],
    { readStdin: async () => 'review body' },
  );

  assert.equal(denied.code, 4);
  assert.equal(JSON.parse(denied.stderr).error.code, 'POLICY_DENIED');
  assertOffline(denied.calls);

  const created = parseSuccess(
    await invoke(
      [
        'mr',
        'comment',
        'create',
        '17',
        '-R',
        '9001',
        '--body-file',
        '-',
        '--severity',
        'major',
        '--confirm-write',
        '--simulate',
      ],
      { readStdin: async () => 'review body' },
    ),
  );

  assert.deepEqual(created.data, {
    comment_id: 'simulation-discussion-9001-17',
    repo_id: '9001',
    mr_iid: '17',
    severity: 'major',
    resolved: false,
    web_url:
      'https://codehub.simulation.invalid/projects/9001/merge_requests/17#simulation-comment',
  });
  assert.equal(created.warnings[1].code, 'UNSAFE_WRITE_GUARANTEES');
});

test('评论 dry-run 仿真保留生产模式的输出结构', async () => {
  const result = parseSuccess(
    await invoke(
      [
        'mr',
        'comment',
        'create',
        '17',
        '-R',
        '9001',
        '--body-file',
        '-',
        '--severity',
        'minor',
        '--confirm-write',
        '--dry-run',
        '--simulate',
      ],
      { readStdin: async () => '仿真 review 🚀' },
    ),
  );

  assert.equal(result.data.dry_run, true);
  assert.equal(result.data.authentication_type, 'private_token');
  assert.equal(
    result.data.body_utf8_bytes,
    Buffer.byteLength('仿真 review 🚀', 'utf8'),
  );
});

test('配置与认证命令在仿真模式下不提示、不持久化', async () => {
  const commands = [
    ['config', 'init', '--simulate', '--output', 'json'],
    ['auth', 'login', '--simulate', '--no-input', '--output', 'json'],
    ['auth', 'status', '--simulate'],
    ['auth', 'logout', '--simulate'],
  ];

  for (const argv of commands) {
    const envelope = parseSuccess(await invoke(argv));
    assert.match(JSON.stringify(envelope.data), /simulation/i);
  }
});

test('human 仿真输出明确标识数据来源', async () => {
  const result = await invoke([
    'mr',
    'view',
    '17',
    '-R',
    '9001',
    '--simulate',
    '--output',
    'human',
  ]);

  assert.equal(result.code, 0);
  assert.match(result.stdout, /simulated merge request 17/);
  assert.match(result.stdout, /SIMULATION_MODE/);
  assert.equal(result.stderr, '');
  assertOffline(result.calls);
});

test('顶层帮助公开仿真开关', async () => {
  const result = await invoke(['--help']);

  assert.equal(result.code, 0);
  assert.match(result.stdout, /--simulate/);
  assert.equal(result.stderr, '');
  assertOffline(result.calls);
});
