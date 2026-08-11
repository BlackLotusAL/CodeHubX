import assert from 'node:assert/strict';
import test from 'node:test';
import { CliError } from '../src/errors.js';
import {
  renderHuman,
  sanitiseForOutput,
  writeFailure,
  writeSuccess,
} from '../src/output.js';
import { captureIo, parseSingleJson } from '../test-support/helpers.js';

const repo = {
  repo_id: '9001',
  full_name: '平台/中文仓库🚀',
  clone_urls: {
    ssh: 'git@code.test:platform/repository.git',
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

test('JSON 成功结果为直接值、两空格缩进、单换行且无 ANSI', () => {
  const { io, capture } = captureIo({ stdoutIsTTY: true });
  writeSuccess(io, 'json', 'repo.list', [repo]);
  assert.deepEqual(parseSingleJson(capture.stdout), [repo]);
  assert.match(capture.stdout, /\n  \{/);
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
  assert.equal(capture.stderr, '[AUTH_ERROR] CodeHub 认证失败。（HTTP 401）\n');
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

test('repo human 输出对齐 SSH/HTTPS 并适配窄终端', () => {
  const output = renderHuman('repo.list', [repo], {
    io: { columns: 60, env: {}, stdoutIsTTY: false },
    now: Date.parse('2026-08-12T00:00:00Z'),
  });
  const lines = output.split('\n');
  assert.match(lines[0], /^ID\s+仓库\s+更新时间/);
  const ssh = lines.find((line) => line.includes('SSH'));
  const https = lines.find((line) => line.includes('HTTPS'));
  assert.equal(ssh.indexOf('git@'), https.indexOf('https://'));
  assert.ok(lines.every((line) => line.length < 100));
});

test('MR 列表按显示宽度处理中文与 Emoji 并显示分支', () => {
  const output = renderHuman('mr.list', [mr], {
    io: { columns: 80, env: {}, stdoutIsTTY: false },
    now: Date.parse('2026-08-12T00:00:00Z'),
  });
  assert.match(output, /IID\s+状态\s+标题\s+作者\s+更新时间/);
  assert.match(output, /fix\/terminal-output → main/);
  assert.match(output, /1 天前/);
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
  assert.match(output, /12 个文件，\+83 \/ -21/);
  assert.ok(output.split('\n').length > 10);
});

test('Commit human 显示父 SHA、作者、提交者和不同的完整消息', () => {
  const output = renderHuman('mr.commits', [{
    sha: '0123456789abcdef',
    title: 'fix: title',
    message: 'fix: title\n\nbody',
    author: { name: 'Author', email: 'author@test' },
    committer: { name: 'Bot', email: 'bot@test' },
    authored_at: '2026-08-01T00:00:00Z',
    committed_at: '2026-08-01T00:00:00Z',
    parent_shas: ['fedcba9876543210'],
  }], { io: { columns: 80, env: {}, stdoutIsTTY: false } });
  assert.match(output, /^0123456789ab fix: title/m);
  assert.match(output, /父 SHA fedcba9876543210/);
  assert.match(output, /Author <author@test>/);
  assert.match(output, /body/);
});

test('所有字符串递归脱敏、移除 URL 凭据和终端控制符', () => {
  const output = sanitiseForOutput({
    token: 'prefix secret suffix',
    nested: ['https://user:password@code.test/path', 'hello\u001B[31mred\u001B[0m\u0001'],
  }, ['secret']);
  assert.deepEqual(output, {
    token: 'prefix [REDACTED] suffix',
    nested: ['https://code.test/path', 'hellored�'],
  });
});

test('本地和认证 human 输出不泄漏配置字段', () => {
  const io = { columns: 80, env: {}, stdoutIsTTY: false };
  assert.equal(
    renderHuman('config.init', { created: false, config_path: '/config.json' }, { io }),
    '配置文件已存在，未覆盖：/config.json',
  );
  assert.doesNotMatch(
    renderHuman('auth.status', {
      configured: true,
      authentication_type: 'devuc',
      api_host: 'https://code.test',
    }, { io }),
    /token|password|AppCode/i,
  );
});
