import assert from 'node:assert/strict';
import test from 'node:test';
import { createInteractivePrompter } from '../src/prompts.js';

const ttyInput = { isTTY: true };
const ttyOutput = { isTTY: true };

test('登录提示使用选择、掩码输入、自定义流和 AbortSignal', async () => {
  const calls = [];
  const controller = new AbortController();
  const promptApi = {
    input: async (options, context) => {
      calls.push({ kind: 'input', options, context });
      return 'Agent01';
    },
    select: async (options, context) => {
      calls.push({ kind: 'select', options, context });
      return 'private_token';
    },
    password: async (options, context) => {
      calls.push({ kind: 'password', options, context });
      return 'secret';
    },
  };
  const prompter = createInteractivePrompter({
    input: ttyInput,
    output: ttyOutput,
    promptApi,
  });
  assert.equal(
    await prompter.chooseAuthenticationType({ signal: controller.signal }),
    'private_token',
  );
  assert.equal(await prompter.readPrivateToken({ signal: controller.signal }), 'secret');
  assert.deepEqual(
    calls[0].options.choices.map((choice) => choice.value),
    ['private_token', 'devuc'],
  );
  assert.equal(calls[1].options.mask, true);
  assert.equal(calls[1].options.theme.prefix.done, '✓');
  assert.equal(calls[0].context.input, ttyInput);
  assert.equal(calls[0].context.output, ttyOutput);
  assert.equal(calls[0].context.signal, controller.signal);
  assert.equal(calls[0].context.clearPromptOnDone, true);
  assert.equal(calls[1].context.clearPromptOnDone, false);
});

test('DevUC 账号明文保留、密码掩码保留且提示层执行校验', async () => {
  const calls = [];
  const prompter = createInteractivePrompter({
    input: ttyInput,
    output: ttyOutput,
    promptApi: {
      select: async () => 'devuc',
      input: async (options, context) => {
        calls.push({ kind: 'input', options, context });
        return 'Agent01';
      },
      password: async (options, context) => {
        calls.push({ kind: 'password', options, context });
        return 'password';
      },
    },
  });
  assert.deepEqual(await prompter.readDevucCredentials(), {
    account: 'Agent01',
    password: 'password',
  });
  assert.equal(calls[0].kind, 'input');
  assert.equal('mask' in calls[0].options, false);
  assert.equal(calls[0].context.clearPromptOnDone, false);
  assert.equal(calls[0].options.theme.prefix.done, '✓');
  assert.equal(calls[0].options.validate('Agent01'), true);
  assert.equal(typeof calls[0].options.validate('bad-name'), 'string');
  assert.equal(calls[1].kind, 'password');
  assert.equal(calls[1].options.mask, true);
  assert.equal(calls[1].options.theme.prefix.done, '✓');
  assert.equal(calls[1].context.clearPromptOnDone, false);
  assert.equal(calls[1].options.validate('password'), true);
  assert.equal(typeof calls[1].options.validate(''), 'string');
});

test('非 TTY 在调用 Inquirer 前返回 INVALID_ARGUMENT', async () => {
  let calls = 0;
  const prompter = createInteractivePrompter({
    input: { isTTY: false },
    output: ttyOutput,
    promptApi: {
      input: async () => {
        calls += 1;
      },
      select: async () => {
        calls += 1;
      },
      password: async () => {
        calls += 1;
      },
    },
  });
  await assert.rejects(prompter.chooseAuthenticationType(), { code: 'INVALID_ARGUMENT' });
  await assert.rejects(prompter.readPrivateToken(), { code: 'INVALID_ARGUMENT' });
  await assert.rejects(prompter.readDevucCredentials(), { code: 'INVALID_ARGUMENT' });
  assert.equal(calls, 0);
});

test('Ctrl+C 与 AbortPromptError 转换为 CANCELLED', async () => {
  for (const name of ['ExitPromptError', 'AbortPromptError', 'AbortError']) {
    const prompter = createInteractivePrompter({
      input: ttyInput,
      output: ttyOutput,
      promptApi: {
        select: async () => {
          throw Object.assign(new Error(name), { name });
        },
        password: async () => {
          throw Object.assign(new Error(name), { name });
        },
      },
    });
    await assert.rejects(prompter.chooseAuthenticationType(), { code: 'CANCELLED' });
  }
});
