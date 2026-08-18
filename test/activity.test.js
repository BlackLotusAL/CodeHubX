import assert from 'node:assert/strict';
import test from 'node:test';
import { createActivity } from '../src/output.js';
import { captureIo } from '../test-support/helpers.js';

test('TTY human spinner 延迟显示、逐帧更新并在停止时清除', () => {
  const clock = manualTimers();
  const { io, capture } = captureIo({
    stdoutIsTTY: true,
    stderrIsTTY: true,
    env: { CLICOLOR_FORCE: '1' },
  });
  const activity = createActivity({
    io,
    format: 'human',
    command: 'repo.list',
    timers: clock.timers,
  });

  assert.equal(activity.enabled, true);
  activity.start();
  assert.equal(capture.stderr, '');
  assert.equal(clock.activeCount('timeout'), 1);

  clock.fireTimeout();
  assert.match(capture.stderr, /\r\u001B\[36m⠋\u001B\[0m 正在获取仓库列表…/);
  assert.equal(clock.activeCount('interval'), 1);
  const firstLength = capture.stderr.length;

  clock.fireInterval();
  assert.ok(capture.stderr.length > firstLength);
  assert.match(capture.stderr, /⠙/);

  activity.stop();
  assert.match(capture.stderr, /\r +\r$/);
  assert.equal(clock.activeCount(), 0);
  const stopped = capture.stderr;
  activity.stop();
  assert.equal(capture.stderr, stopped);
});

test('spinner 在 NO_COLOR 下不产生 ANSI，并为每个业务命令提供明确文案', () => {
  const expected = new Map([
    ['repo.list', '正在获取仓库列表…'],
    ['repo.view', '正在获取仓库详情…'],
    ['mr.list', '正在获取 Merge Request 列表…'],
    ['mr.view', '正在获取 Merge Request 详情…'],
    ['mr.commits', '正在获取 Commit 列表…'],
    ['mr.comment.create', '正在创建评论…'],
  ]);

  for (const [command, message] of expected) {
    const clock = manualTimers();
    const { io, capture } = captureIo({
      stdoutIsTTY: true,
      stderrIsTTY: true,
      env: { NO_COLOR: '' },
    });
    const activity = createActivity({ io, format: 'human', command, timers: clock.timers });
    activity.start();
    clock.fireTimeout();
    activity.stop();
    assert.match(capture.stderr, new RegExp(message.replace('…', '…')));
    assert.doesNotMatch(capture.stderr, /\u001B/);
    assert.equal(clock.activeCount(), 0);
  }
});

test('快速完成、失败和取消都通过 finally 清理 timer', async () => {
  const fastClock = manualTimers();
  const fast = captureIo({ stdoutIsTTY: true, stderrIsTTY: true });
  const fastActivity = createActivity({
    io: fast.io,
    format: 'human',
    command: 'mr.view',
    timers: fastClock.timers,
  });
  assert.equal(await fastActivity.run(async () => 'done'), 'done');
  assert.equal(fast.capture.stderr, '');
  assert.equal(fastClock.activeCount(), 0);

  for (const error of [
    new Error('failed'),
    Object.assign(new Error('cancelled'), { name: 'AbortError' }),
  ]) {
    const clock = manualTimers();
    const { io, capture } = captureIo({ stdoutIsTTY: true, stderrIsTTY: true });
    const activity = createActivity({
      io,
      format: 'human',
      command: 'mr.comment.create',
      timers: clock.timers,
    });
    await assert.rejects(
      activity.run(async () => {
        clock.fireTimeout();
        throw error;
      }),
      error,
    );
    assert.match(capture.stderr, /正在创建评论…/);
    assert.match(capture.stderr, /\r +\r$/);
    assert.equal(clock.activeCount(), 0);
  }
});

test('JSON、非 TTY 和本地命令完全禁用 spinner', async () => {
  const cases = [
    { format: 'json', command: 'repo.list', stdoutIsTTY: true, stderrIsTTY: true },
    { format: 'human', command: 'repo.list', stdoutIsTTY: false, stderrIsTTY: true },
    { format: 'human', command: 'repo.list', stdoutIsTTY: true, stderrIsTTY: false },
    { format: 'human', command: 'auth.login', stdoutIsTTY: true, stderrIsTTY: true },
    { format: 'human', command: 'config.init', stdoutIsTTY: true, stderrIsTTY: true },
  ];

  for (const settings of cases) {
    const clock = manualTimers();
    const { io, capture } = captureIo(settings);
    const activity = createActivity({
      io,
      format: settings.format,
      command: settings.command,
      timers: clock.timers,
    });
    assert.equal(activity.enabled, false);
    activity.start();
    assert.equal(await activity.run(async () => 42), 42);
    activity.stop();
    assert.equal(clock.createdCount(), 0);
    assert.equal(capture.stderr, '');
  }
});

function manualTimers() {
  const handles = [];

  const create = (kind, callback) => {
    const handle = {
      kind,
      callback,
      active: true,
      unrefed: false,
      unref() {
        this.unrefed = true;
      },
    };
    handles.push(handle);
    return handle;
  };

  const clear = (handle) => {
    if (handle) handle.active = false;
  };

  const fire = (kind) => {
    const handle = handles.find((candidate) => candidate.kind === kind && candidate.active);
    assert.ok(handle, `missing active ${kind}`);
    if (kind === 'timeout') handle.active = false;
    handle.callback();
  };

  return {
    timers: {
      setTimeout: (callback) => create('timeout', callback),
      clearTimeout: clear,
      setInterval: (callback) => create('interval', callback),
      clearInterval: clear,
    },
    fireTimeout: () => fire('timeout'),
    fireInterval: () => fire('interval'),
    activeCount: (kind) =>
      handles.filter((handle) => handle.active && (!kind || handle.kind === kind)).length,
    createdCount: () => handles.length,
  };
}
