import assert from 'node:assert/strict';
import test from 'node:test';
import stringWidth from 'string-width';
import { CliError } from '../src/errors.js';
import { renderHuman, writeFailure, writeSuccess } from '../src/output.js';
import { captureIo, parseSingleJson } from '../test-support/helpers.js';

const repo = {
  repo_id: '9001',
  full_name: '平台/中文仓库🚀',
  clone_urls: {
    ssh: 'ssh://git@code.test/platform/repository.git',
    https: 'https://code.test/platform/repository.git',
  },
  archived: false,
  updated_at: '2026-08-01T00:00:00Z',
};

const mr = {
  repo_id: '9001',
  mr_id: '701',
  iid: '17',
  title: '修复中文对齐 🚀 并处理很长很长的标题',
  state: 'opened',
  is_draft: false,
  author: { id: '1', username: 'lin', name: '林开发者', type: 'user' },
  source_branch: 'fix/terminal-output',
  target_branch: 'main',
  updated_at: '2026-08-11T00:00:00Z',
  web_url: 'https://code.test/mr/17',
};

const ANSI_STYLE_PATTERN = /\u001B\[[\d;]+m/g;

test('JSON 成功结果为直接值、两空格缩进、单换行且无 ANSI', () => {
  const { io, capture } = captureIo({ stdoutIsTTY: true });
  writeSuccess(io, 'json', 'repo.list', [repo]);
  assert.deepEqual(parseSingleJson(capture.stdout), [repo]);
  assert.match(capture.stdout, /\n {2}\{/);
  assert.doesNotMatch(capture.stdout, /\u001B\[/);
  assert.equal(capture.stderr, '');
});

test('JSON 错误仅写 stderr 且只包含允许字段', () => {
  const { io, capture } = captureIo();
  writeFailure(io, 'json', new CliError('HTTP_ERROR', { httpStatus: 403 }));
  assert.equal(capture.stdout, '');
  assert.deepEqual(parseSingleJson(capture.stderr), {
    code: 'HTTP_ERROR',
    message: 'CodeHub request failed.',
    http_status: 403,
  });
});

test('human 错误使用简体中文、稳定错误码和可选状态码', () => {
  const { io, capture } = captureIo();
  writeFailure(io, 'human', new CliError('AUTH_ERROR', { httpStatus: 401 }));
  assert.equal(capture.stdout, '');
  assert.equal(capture.stderr, '✗ [AUTH_ERROR] CodeHub 认证失败。（HTTP 401）\n');
});

test('颜色只在允许时输出且 CLICOLOR_FORCE 优先', () => {
  for (const [settings, expected] of [
    [{ stderrIsTTY: true, env: {} }, true],
    [{ stderrIsTTY: false, env: {} }, false],
    [{ stderrIsTTY: true, env: { NO_COLOR: '' } }, false],
    [{ stderrIsTTY: true, env: { CLICOLOR: '0' } }, false],
    [{ stderrIsTTY: true, env: { TERM: 'dumb' } }, false],
    [{ stderrIsTTY: false, env: { NO_COLOR: '', CLICOLOR_FORCE: '1' } }, true],
  ]) {
    const { io, capture } = captureIo(settings);
    writeFailure(io, 'human', new CliError('NETWORK_ERROR'));
    assert.equal(/\u001B\[31m/.test(capture.stderr), expected);
  }
});

test('成功与失败图标使用统一字形和语义色', () => {
  const io = { columns: 100, env: { CLICOLOR_FORCE: '1' }, stdoutIsTTY: false };
  const authentication = renderHuman(
    'auth.login',
    {
      configured: true,
      authentication_type: 'private_token',
      api_host: 'https://code.test',
    },
    { io },
  );
  assert.match(authentication, /^\u001B\[32m✓\u001B\[0m/);

  const closedMergeRequest = renderHuman('mr.view', { ...mr, state: 'closed' }, { io });
  assert.match(closedMergeRequest, /^\u001B\[31m✗\u001B\[0m/);

  const { io: errorIo, capture } = captureIo({
    stderrIsTTY: false,
    env: { CLICOLOR_FORCE: '1' },
  });
  writeFailure(errorIo, 'human', new CliError('AUTH_ERROR'));
  assert.match(capture.stderr, /^\u001B\[31m✗\u001B\[0m/);
});

test('repo human 输出对齐 SSH/HTTPS 并适配窄终端', () => {
  const output = renderHuman('repo.list', [repo], {
    io: { columns: 60, env: {}, stdoutIsTTY: false },
    now: Date.parse('2026-08-12T00:00:00Z'),
  });
  const lines = output.split('\n');
  assert.equal(lines[0], '共 1 个仓库');
  assert.match(output, /● 9001 {2}平台\/中文仓库🚀/);
  assert.match(output, /active · 更新 11 天前/);
  const ssh = lines.find((line) => line.includes('SSH'));
  const https = lines.find((line) => line.includes('HTTPS'));
  assert.equal(ssh.indexOf('ssh://'), https.indexOf('https://'));
  assert.match(ssh, /ssh:\/\/git@code\.test\/platform\/repository\.git/);
  assert.ok(lines.every((line) => line.length < 100));
});

test('MR 列表按显示宽度处理中文与 Emoji 并显示分支', () => {
  const output = renderHuman('mr.list', [mr], {
    io: { columns: 80, env: {}, stdoutIsTTY: false },
    now: Date.parse('2026-08-12T00:00:00Z'),
  });
  assert.match(output, /^共 1 个 Merge Request/);
  assert.match(output, /● !17 {2}修复中文对齐 🚀/);
  assert.match(output, /opened · 林开发者 · 1 天前/);
  assert.match(output, /fix\/terminal-output → main/);
});

test('列表时间在 30 天内相对显示，超过 30 天显示日期', () => {
  const now = Date.parse('2026-08-31T00:00:00Z');
  const rows = [
    { ...repo, repo_id: '1', updated_at: '2026-08-31T00:00:00Z' },
    { ...repo, repo_id: '2', updated_at: '2026-08-30T23:30:00Z' },
    { ...repo, repo_id: '3', updated_at: '2026-08-30T00:00:00Z' },
    { ...repo, repo_id: '4', updated_at: '2026-08-01T00:00:00Z' },
    { ...repo, repo_id: '5', updated_at: '2026-07-31T23:59:59Z' },
  ];
  const output = renderHuman('repo.list', rows, {
    io: { columns: 100, env: {}, stdoutIsTTY: false },
    now,
  });
  assert.match(output, /刚刚/);
  assert.match(output, /30 分钟前/);
  assert.match(output, /1 天前/);
  assert.match(output, /30 天前/);
  assert.match(output, /2026-07-31/);
});

test('详情时间转换为 RFC 3339 UTC 且长描述换行', () => {
  const detail = {
    ...mr,
    labels: ['cli', 'review-ready'],
    created_at: '2026-07-30T03:00:00+08:00',
    changes: { files: 12, additions: 83, deletions: 21 },
    description: '这是一个非常长的描述，用于验证窄终端会根据显示宽度换行而不会破坏内容。',
  };
  const output = renderHuman('mr.view', detail, {
    io: { columns: 45, env: {}, stdoutIsTTY: false },
  });
  assert.match(output, /2026-07-29T19:00:00.000Z/);
  assert.match(output, /12 个文件 · \+83 · -21/);
  assert.match(output, /^变更$/m);
  assert.match(output, /^描述$/m);
  assert.match(output, /标签 \[cli\] \[review-ready\]/);
  assert.ok(output.split('\n').length > 10);
});

test('Commit human 显示父 SHA、作者、提交者和不同的完整消息', () => {
  const output = renderHuman(
    'mr.commits',
    [
      {
        sha: '0123456789abcdef',
        title: 'fix: title',
        message: 'fix: title\n\nbody',
        author: { name: 'Author', email: 'author@test' },
        committer: { name: 'Bot', email: 'bot@test' },
        authored_at: '2026-08-01T00:00:00Z',
        committed_at: '2026-08-01T00:00:00Z',
        parent_shas: ['fedcba9876543210'],
      },
    ],
    { io: { columns: 80, env: {}, stdoutIsTTY: false } },
  );
  assert.match(output, /^共 1 个 Commit/);
  assert.match(output, /^● 0123456789ab {2}fix: title/m);
  assert.match(output, /父 SHA fedcba9876543210/);
  assert.match(output, /Author <author@test>/);
  assert.match(output, /body/);
});

test('JSON 原样保留业务字段，同时转义实际终端控制字符', () => {
  const data = {
    token: 'prefix secret suffix',
    nested: [
      'ssh://git@code.test/platform/repository.git',
      'https://user:password@code.test/path',
      'hello\u001B[31mred\u001B[0m\u0001\u009B31m',
    ],
  };
  const { io, capture } = captureIo({ stdoutIsTTY: true });
  writeSuccess(io, 'json', 'repo.view', data);
  assert.deepEqual(parseSingleJson(capture.stdout), data);
  assert.match(capture.stdout, /ssh:\/\/git@code\.test/);
  assert.match(capture.stdout, /https:\/\/user:password@code\.test/);
  assert.match(capture.stdout, /prefix secret suffix/);
  assert.doesNotMatch(capture.stdout, /\u001B|\u009B/);
  assert.match(capture.stdout, /\\u001b/);
  assert.match(capture.stdout, /\\u009b/);
});

test('本地和认证 human 输出不泄漏配置字段', () => {
  const io = { columns: 80, env: {}, stdoutIsTTY: false };
  assert.equal(
    renderHuman('config.init', { created: false, config_path: '/config.json' }, { io }),
    '! 配置文件已存在，未覆盖\n  路径  /config.json',
  );
  assert.doesNotMatch(
    renderHuman(
      'auth.status',
      {
        configured: true,
        authentication_type: 'devuc',
        api_host: 'https://code.test',
      },
      { io },
    ),
    /token|password|AppCode/i,
  );
});

test('卡片主题按语义区分标题、标识、链接、状态、标签和变更', () => {
  const io = { columns: 100, env: { CLICOLOR_FORCE: '1' }, stdoutIsTTY: false };
  const repository = renderHuman('repo.list', [repo], {
    io,
    now: Date.parse('2026-08-12T00:00:00Z'),
  });
  assert.match(repository, /\u001B\[32m●\u001B\[0m/);
  assert.match(repository, /\u001B\[36m9001\u001B\[0m/);
  assert.match(repository, /\u001B\[1m平台\/中文仓库🚀\u001B\[0m/);
  assert.match(repository, /\u001B\[36;4mhttps:\/\/code\.test/);
  assert.match(repository, /\u001B\[2m更新 11 天前\u001B\[0m/);

  const detail = renderHuman(
    'mr.view',
    {
      ...mr,
      labels: ['cli', 'review-ready'],
      created_at: '2026-08-01T00:00:00Z',
      changes: { files: 2, additions: 8, deletions: 3 },
      description: '描述',
    },
    { io },
  );
  assert.match(detail, /\u001B\[32mopened\u001B\[0m/);
  assert.match(detail, /\u001B\[35m\[cli\]\u001B\[0m/);
  assert.match(detail, /\u001B\[32m\+8\u001B\[0m/);
  assert.match(detail, /\u001B\[31m-3\u001B\[0m/);
  assert.match(detail, /\u001B\[36;4mhttps:\/\/code\.test\/mr\/17\u001B\[0m/);
});

test('评论严重级别与 human 错误使用独立语义色和图标', () => {
  const io = { columns: 100, env: { CLICOLOR_FORCE: '1' }, stdoutIsTTY: false };
  for (const [severity, code] of [
    ['suggestion', '36'],
    ['minor', '33'],
    ['major', '35'],
    ['fatal', '31'],
  ]) {
    const output = renderHuman(
      'mr.comment.create',
      {
        comment_id: '7',
        repo_id: '1',
        mr_iid: '2',
        severity,
        resolved: false,
        web_url: null,
      },
      { io },
    );
    assert.match(output, new RegExp(`\\u001B\\[${code}m${severity}\\u001B\\[0m`));
  }

  for (const [error, iconCode, codeStyle] of [
    [new CliError('HTTP_ERROR'), '31', '1;31'],
    [new CliError('WRITE_RESULT_UNKNOWN'), '33', '1;33'],
    [new CliError('CANCELLED'), '2', '2'],
  ]) {
    const { io: errorIo, capture } = captureIo({ stderrIsTTY: true });
    writeFailure(errorIo, 'human', error);
    assert.match(capture.stderr, new RegExp(`\\u001B\\[${iconCode}m`));
    assert.match(capture.stderr, new RegExp(`\\u001B\\[${codeStyle}m\\[${error.code}\\]`));
    assert.match(
      capture.stderr.replace(ANSI_STYLE_PATTERN, ''),
      new RegExp(`^[✓●○!✗] \\[${error.code}\\]`),
    );
  }
});

test('所有 public human 结果在无色模式仍保留文字和图标', () => {
  const io = { columns: 100, env: { NO_COLOR: '' }, stdoutIsTTY: true };
  const samples = [
    ['config.init', { created: true, config_path: '/config.json' }, /^✓ 已创建配置文件/],
    [
      'auth.login',
      { configured: true, authentication_type: 'private_token', api_host: 'https://code.test' },
      /^✓ 认证已配置/,
    ],
    [
      'auth.status',
      { configured: false, authentication_type: null, api_host: 'https://code.test' },
      /^○ 未登录/,
    ],
    [
      'auth.logout',
      { credential_helper_cleared: true, api_host: 'https://code.test' },
      /^✓ 本地认证凭据已清除/,
    ],
    ['repo.list', [repo], /^共 1 个仓库/],
    [
      'repo.view',
      { ...repo, default_branch: 'main', web_url: 'https://code.test/repo' },
      /^● Project 9001/,
    ],
    ['mr.list', [mr], /^共 1 个 Merge Request/],
    [
      'mr.view',
      { ...mr, labels: null, created_at: null, changes: null, description: null },
      /^● !17/,
    ],
    [
      'mr.commits',
      [
        {
          sha: 'abcdef1234567890',
          title: 'feat: card',
          message: 'feat: card',
          author: null,
          committer: null,
          committed_at: null,
          parent_shas: [],
        },
      ],
      /^共 1 个 Commit/,
    ],
    [
      'mr.comment.create',
      {
        comment_id: '7',
        repo_id: '9001',
        mr_iid: '17',
        severity: 'suggestion',
        resolved: false,
        web_url: null,
      },
      /^✓ 评论已创建/,
    ],
  ];

  for (const [command, data, marker] of samples) {
    const output = renderHuman(command, data, { io });
    assert.match(output, marker, command);
    assert.doesNotMatch(output, /\u001B/, command);
  }
});

test('卡片在 40、80、240 列下保持 ANSI-aware 宽度并过滤上游控制符', () => {
  for (const columns of [40, 80, 240]) {
    const output = renderHuman(
      'repo.list',
      [
        {
          ...repo,
          full_name: `平台/\u001B[31m恶意\u001B[0m/很长很长的中文仓库🚀-${'x'.repeat(120)}\u0001`,
          clone_urls: {
            ssh: `ssh://git@code.test/${'segment/'.repeat(30)}repository.git`,
            https: `https://code.test/${'segment/'.repeat(30)}repository.git`,
          },
        },
      ],
      {
        io: { columns, env: { CLICOLOR_FORCE: '1' }, stdoutIsTTY: false },
        now: Date.parse('2026-08-12T00:00:00Z'),
      },
    );
    assert.doesNotMatch(output, /\u001B\[31m/);
    assert.match(output, /恶意/);
    assert.match(output, /�/);
    for (const line of output.split('\n')) {
      assert.ok(stringWidth(line) <= columns, `${columns}: ${stringWidth(line)} ${line}`);
    }
  }
});
