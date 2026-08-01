import assert from 'node:assert/strict';
import { PassThrough, Writable } from 'node:stream';
import test from 'node:test';
import { AUTH_TYPES } from '../src/constants.js';
import { runLoginPrompt } from '../src/prompts.js';

test('登录向导默认选择 Private Token，并掩码显示敏感输入', async () => {
  const terminal = createTerminal();
  const answerPromise = runLoginPrompt({
    input: terminal.input,
    output: terminal.output,
    env: {},
  });

  await sendKeys(terminal.input, ['\r', 'private-secret\r']);
  const answers = await answerPromise;
  const screen = terminal.screen();

  assert.deepEqual(answers, {
    method: AUTH_TYPES.PRIVATE_TOKEN,
    token: 'private-secret',
  });
  assert.match(screen, /CodeHub 登录/);
  assert.match(screen, /使用 ↑\/↓ 选择/);
  assert.match(screen, /Private Token/);
  assert.match(screen, /\*+/);
  assert.doesNotMatch(screen, /private-secret/);
  assert.match(screen, /\u001B\[/);
});

test('登录向导可用向下方向键选择 DevUC', async () => {
  const terminal = createTerminal();
  const answerPromise = runLoginPrompt({
    input: terminal.input,
    output: terminal.output,
    env: { NO_COLOR: '1' },
  });

  await sendKeys(terminal.input, [
    '\u001B[B\r',
    'agent123\r',
    'devuc-secret\r',
  ]);
  const answers = await answerPromise;
  const screen = terminal.screen();

  assert.deepEqual(answers, {
    method: 'devuc',
    account: 'agent123',
    password: 'devuc-secret',
  });
  assert.match(screen, /DevUC 账号/);
  assert.match(screen, /\*+/);
  assert.doesNotMatch(screen, /devuc-secret/);
  assert.doesNotMatch(screen, /\u001B\[[0-9;]*m/);
});

test('登录向导把 Ctrl+C 转换为稳定的取消错误', async () => {
  const terminal = createTerminal();
  const answerPromise = runLoginPrompt({
    input: terminal.input,
    output: terminal.output,
    env: {},
  });

  await sendKeys(terminal.input, ['\u0003']);

  await assert.rejects(answerPromise, {
    code: 'CANCELLED',
    exitCode: 130,
  });
  assert.equal(terminal.input.isRaw, false);
});

function createTerminal() {
  const input = new PassThrough();
  const chunks = [];
  const output = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(String(chunk));
      callback();
    },
  });

  input.isTTY = true;
  input.isRaw = false;
  input.setRawMode = (enabled) => {
    input.isRaw = enabled;
    return input;
  };
  output.isTTY = true;
  output.columns = 100;
  // 每个 Inquirer prompt 都会结束自己的输出管道；真实的 stderr 不会因此关闭。
  output.end = function end(chunk, encoding, callback) {
    if (chunk !== undefined && chunk !== null) {
      this.write(chunk, encoding);
    }
    if (typeof encoding === 'function') {
      encoding();
    } else if (typeof callback === 'function') {
      callback();
    }
    return this;
  };

  return {
    input,
    output,
    screen: () => chunks.join(''),
  };
}

async function sendKeys(input, groups) {
  for (const keys of groups) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    input.write(keys);
  }
}
