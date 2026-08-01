import assert from 'node:assert/strict';
import test from 'node:test';
import stringWidth from 'string-width';
import {
  errorEnvelope,
  renderHuman,
  successEnvelope,
  writeError,
  writeSuccess,
} from '../src/output.js';
import {
  projectCommitList,
  projectMergeRequestList,
  projectMergeRequestView,
  projectRepoList,
} from '../src/transform.js';
import { CliError } from '../src/errors.js';
import {
  commitApiFixture,
  mergeRequestApiFixture,
  repoApiFixture,
} from '../test-support/fixtures.js';
import { captureIo } from '../test-support/helpers.js';

const ANSI_PATTERN = /\u001B\[[0-9;]*m/g;
const NOW = new Date('2026-08-01T08:30:00Z');

test('JSON 成功与错误始终两空格缩进、单文档、无 ANSI', () => {
  const successCapture = captureIo();
  const success = successEnvelope('repo.list', 'req-json', [], []);
  writeSuccess(successCapture.io, 'json', success, {
    stdoutIsTTY: true,
    env: { CLICOLOR_FORCE: '1' },
  });

  assert.equal(
    successCapture.stdout(),
    `${JSON.stringify(success, null, 2)}\n`,
  );
  assert.doesNotMatch(successCapture.stdout(), ANSI_PATTERN);
  assert.deepEqual(JSON.parse(successCapture.stdout()), success);

  const errorCapture = captureIo();
  const error = errorEnvelope(
    'mr.view',
    'req-error',
    new CliError('INVALID_ARGUMENT', '参数错误'),
  );
  writeError(errorCapture.io, 'json', error, {
    stderrIsTTY: true,
    env: { CLICOLOR_FORCE: '1' },
  });

  assert.equal(errorCapture.stderr(), `${JSON.stringify(error, null, 2)}\n`);
  assert.doesNotMatch(errorCapture.stderr(), ANSI_PATTERN);
  assert.deepEqual(JSON.parse(errorCapture.stderr()), error);
});

test('repo human 列表以紧凑条目显示两种 clone URL', () => {
  const output = renderHuman(
    'repo.list',
    projectRepoList([repoApiFixture]),
    [],
    { columns: 120, now: NOW, env: {}, stdoutIsTTY: false },
  );

  assert.match(output, /9001\s+platform\/agent-tools\s+1 天前/);
  assert.match(output, /SSH git@codehub\.test:platform\/agent-tools\.git/);
  assert.match(
    output,
    /HTTPS https:\/\/codehub\.test\/platform\/agent-tools\.git/,
  );
  assert.doesNotMatch(output, ANSI_PATTERN);
});

test('MR human 列表按显示宽度对齐中文和 Emoji，并适配 80/120 列', () => {
  const data = projectMergeRequestList([
    mergeRequestApiFixture,
    {
      ...mergeRequestApiFixture,
      id: 702,
      iid: 18,
      title: 'A much longer title that must be truncated safely 中文 🚀🚀',
      author: { id: 89, username: 'another-developer' },
    },
  ]);

  for (const columns of [80, 120]) {
    const output = renderHuman('mr.list', data, [], {
      columns,
      now: NOW,
      env: {},
      stdoutIsTTY: false,
    });
    const lines = output.split('\n');
    assert.match(lines[0], /MR\s+TITLE\s+AUTHOR\s+BRANCH\s+UPDATED/);
    assert.ok(
      lines.every((line) => stringWidth(line) <= columns),
      `存在超过 ${columns} 列的行：\n${output}`,
    );
    assert.match(output, /#17 OPEN/);
    assert.match(output, /fix\/termina/);
    assert.match(output, /→ main/);
    if (columns === 120) {
      assert.match(output, /fix\/terminal-output → main/);
    }
  }
});

test('human 颜色只在允许的终端中出现，并支持 NO_COLOR 与强制颜色', () => {
  const data = projectMergeRequestList([mergeRequestApiFixture]);
  const colored = renderHuman('mr.list', data, [], {
    columns: 100,
    now: NOW,
    env: {},
    stdoutIsTTY: true,
  });
  assert.match(colored, ANSI_PATTERN);

  const noColor = renderHuman('mr.list', data, [], {
    columns: 100,
    now: NOW,
    env: { NO_COLOR: '' },
    stdoutIsTTY: true,
  });
  assert.doesNotMatch(noColor, ANSI_PATTERN);

  for (const env of [{ CLICOLOR: '0' }, { TERM: 'dumb' }]) {
    const disabled = renderHuman('mr.list', data, [], {
      columns: 100,
      now: NOW,
      env,
      stdoutIsTTY: true,
    });
    assert.doesNotMatch(disabled, ANSI_PATTERN);
  }

  const redirected = renderHuman('mr.list', data, [], {
    columns: 100,
    now: NOW,
    env: {},
    stdoutIsTTY: false,
  });
  assert.doesNotMatch(redirected, ANSI_PATTERN);

  const forced = renderHuman('mr.list', data, [], {
    columns: 100,
    now: NOW,
    env: { CLICOLOR_FORCE: '1', NO_COLOR: '' },
    stdoutIsTTY: false,
  });
  assert.match(forced, ANSI_PATTERN);
});

test('列表使用相对时间，详情使用 RFC 3339 UTC', () => {
  const list = renderHuman(
    'mr.list',
    projectMergeRequestList([mergeRequestApiFixture]),
    [],
    { columns: 120, now: NOW, env: {}, stdoutIsTTY: false },
  );
  assert.match(list, /1 天前/);

  const detail = renderHuman(
    'mr.view',
    projectMergeRequestView(mergeRequestApiFixture),
    [],
    { columns: 100, now: NOW, env: {}, stdoutIsTTY: false },
  );
  assert.match(detail, /2026-07-29T19:00:00\.000Z/);
  assert.match(detail, /2026-07-31T08:30:00\.000Z/);
  assert.match(detail, /12 个文件\s+\+83\s+-21/);
  assert.doesNotMatch(detail, /reviewer|assignee/);
});

test('相对时间覆盖刚刚、分钟、小时、30 天和绝对日期边界', () => {
  const durations = [
    ['刚刚', 30_000],
    ['1 分钟前', 60_000],
    ['1 小时前', 60 * 60_000],
    ['30 天前', 30 * 24 * 60 * 60_000],
    ['2026-07-01', 31 * 24 * 60 * 60_000],
  ];
  const data = durations.map(([label, duration], index) => ({
    repo_id: String(index + 1),
    full_name: `time/${label}`,
    clone_urls: { ssh: null, https: null },
    archived: false,
    updated_at: new Date(NOW.valueOf() - duration).toISOString(),
  }));
  const output = renderHuman('repo.list', data, [], {
    columns: 120,
    now: NOW,
    env: {},
    stdoutIsTTY: false,
  });

  for (const [label] of durations) {
    assert.match(output, new RegExp(label.replace(' ', '\\s')));
  }
  assert.doesNotMatch(output, /SSH|HTTPS/);
});

test('Commit human 卡片显示父 SHA，并仅在消息不同于标题时显示消息', () => {
  const commits = projectCommitList([
    commitApiFixture,
    {
      ...commitApiFixture,
      id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      title: 'same message',
      message: 'same message',
      committer_name: undefined,
      committer_email: undefined,
    },
  ]);
  const output = renderHuman('mr.commits', commits, [], {
    columns: 80,
    now: NOW,
    env: {},
    stdoutIsTTY: false,
  });

  assert.match(output, /01234567 fix: align terminal output/);
  assert.match(
    output,
    /fedcba9876543210fedcba9876543210fedcba98/,
  );
  assert.match(output, /作者时间\s+1 天前/);
  assert.match(output, /提交时间\s+1 天前/);
  assert.match(output, /消息\n\s+fix: align terminal output/);
  assert.equal((output.match(/^消息$/gm) ?? []).length, 1);
  assert.doesNotMatch(output, /提交者\s+-/);
});

test('human 详情中的长标题、标签和描述也遵守窄终端宽度', () => {
  const detail = projectMergeRequestView({
    ...mergeRequestApiFixture,
    title: '这是一个非常长的 Merge Request 标题 🚀 with more text',
    description:
      '这是一段需要根据终端宽度自动换行的详细说明，并且不能破坏中文或 Emoji 🚀。',
    labels: ['very-long-review-label', '中文标签内容很长'],
  });
  const output = renderHuman('mr.view', detail, [], {
    columns: 40,
    now: NOW,
    env: {},
    stdoutIsTTY: false,
  });

  assert.ok(
    output.split('\n').every((line) => stringWidth(line) <= 40),
    output,
  );
});

test('human 会转义服务端控制符，warning 与错误使用克制状态色', () => {
  const unsafe = projectMergeRequestList([
    { ...mergeRequestApiFixture, title: '\u001B[31m伪造红色标题' },
  ]);
  const plain = renderHuman('mr.list', unsafe, [], {
    columns: 100,
    now: NOW,
    env: {},
    stdoutIsTTY: false,
  });
  assert.doesNotMatch(plain, ANSI_PATTERN);
  assert.match(plain, /\\u001b\[31m伪造红色标题/i);

  const detail = renderHuman(
    'mr.view',
    projectMergeRequestView({
      ...mergeRequestApiFixture,
      title: '\u001B[31m伪造详情标题',
    }),
    [],
    { columns: 100, env: {}, stdoutIsTTY: false },
  );
  assert.doesNotMatch(detail, ANSI_PATTERN);
  assert.match(detail, /\\u001b\[31m伪造详情标题/i);

  const newlineTitle = renderHuman(
    'mr.list',
    projectMergeRequestList([
      { ...mergeRequestApiFixture, title: '第一行\n伪造表格行' },
    ]),
    [],
    { columns: 100, env: {}, stdoutIsTTY: false },
  );
  assert.equal(newlineTitle.split('\n').length, 2);
  assert.match(newlineTitle, /第一行 伪造表格行/);

  const colored = renderHuman(
    'repo.list',
    [],
    [{ code: 'PARTIAL_LIST_POSSIBLE', message: '列表可能不完整。' }],
    { columns: 100, env: {}, stdoutIsTTY: true },
  );
  assert.match(colored, /\u001B\[33m/);

  const capture = captureIo();
  writeError(
    capture.io,
    'human',
    errorEnvelope(
      'repo.view',
      'req-human-error',
      new CliError('NOT_FOUND', '资源不存在'),
    ),
    { env: {}, stderrIsTTY: true },
  );
  assert.match(capture.stderr(), /\u001B\[31m/);
});
