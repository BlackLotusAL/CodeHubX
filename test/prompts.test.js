import assert from 'node:assert/strict';
import test from 'node:test';
import { createInteractivePrompter } from '../src/prompts.js';

const ttyInput = { isTTY: true };
const ttyOutput = { isTTY: true };

test('登录提示使用选择、掩码输入、自定义流和 AbortSignal', async () => {
  const calls = [];
  const controller = new AbortController();
  const promptApi = {
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
  assert.deepEqual(calls[0].options.choices.map((choice) => choice.value), ['private_token', 'devuc']);
  assert.equal(calls[1].options.mask, true);
  assert.equal(calls[0].context.input, ttyInput);
  assert.equal(calls[0].context.output, ttyOutput);
  assert.equal(calls[0].context.signal, controller.signal);
  assert.equal(calls[0].context.clearPromptOnDone, true);
});

test('DevUC 账号与密码均掩码且提示层执行校验', async () => {
  const options = [];
  const answers = ['Agent01', 'password'];
  const prompter = createInteractivePrompter({
    input: ttyInput,
    output: ttyOutput,
    promptApi: {
      select: async () => 'devuc',
      password: async (config) => {
        options.push(config);
        return answers.shift();
      },
    },
  });
  assert.deepEqual(await prompter.readDevucCredentials(), {
    account: 'Agent01',
    password: 'password',
  });
  assert.equal(options.every((value) => value.mask === true), true);
  assert.equal(options[0].validate('Agent01'), true);
  assert.equal(typeof options[0].validate('bad-name'), 'string');
  assert.equal(options[1].validate('password'), true);
  assert.equal(typeof options[1].validate(''), 'string');
});

test('非 TTY 在调用 Inquirer 前返回 INVALID_ARGUMENT', async () => {
  let calls = 0;
  const prompter = createInteractivePrompter({
    input: { isTTY: false },
    output: ttyOutput,
    promptApi: {
      select: async () => { calls += 1; },
      password: async () => { calls += 1; },
    },
  });
  await assert.rejects(prompter.chooseAuthenticationType(), { code: 'INVALID_ARGUMENT' });
  await assert.rejects(prompter.readPrivateToken(), { code: 'INVALID_ARGUMENT' });
  assert.equal(calls, 0);
});

test('Ctrl+C 与 AbortPromptError 转换为 CANCELLED', async () => {
  for (const name of ['ExitPromptError', 'AbortPromptError', 'AbortError']) {
    const prompter = createInteractivePrompter({
      input: ttyInput,
      output: ttyOutput,
      promptApi: {
        select: async () => { throw Object.assign(new Error(name), { name }); },
        password: async () => { throw Object.assign(new Error(name), { name }); },
      },
    });
    await assert.rejects(prompter.chooseAuthenticationType(), { code: 'CANCELLED' });
  }
});
