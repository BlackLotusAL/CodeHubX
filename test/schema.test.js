import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import Ajv2020 from 'ajv/dist/2020.js';
import { runCli } from '../src/cli.js';
import { AUTH_TYPES } from '../src/constants.js';
import {
  commentApiFixture,
  commitApiFixture,
  mergeRequestApiFixture,
  repoApiFixture,
} from '../test-support/fixtures.js';
import {
  captureIo,
  jsonResponse,
  MemoryConfigStore,
  MemoryCredentialStore,
  testEnv,
} from '../test-support/helpers.js';

const ajv = new Ajv2020();
const successSchema = JSON.parse(
  await readFile(new URL('../schemas/success.schema.json', import.meta.url)),
);
const errorSchema = JSON.parse(
  await readFile(new URL('../schemas/error.schema.json', import.meta.url)),
);
const validateSuccess = ajv.compile(successSchema);
const validateError = ajv.compile(errorSchema);

test('本地命令成功信封通过发布 Schema', async () => {
  const capture = captureIo();
  const code = await runCli(['capabilities', '--request-id', 'schema.success'], {
    env: testEnv(),
    io: capture.io,
    configStore: new MemoryConfigStore(),
    credentialStore: new MemoryCredentialStore(),
  });
  const envelope = JSON.parse(capture.stdout());

  assert.equal(code, 0);
  assert.equal(validateSuccess(envelope), true, JSON.stringify(validateSuccess.errors));
});

test('参数错误信封通过发布 Schema', async () => {
  const capture = captureIo();
  const code = await runCli(['mr', 'view', '0', '-R', '2'], {
    env: testEnv(),
    io: capture.io,
    configStore: new MemoryConfigStore(),
    credentialStore: new MemoryCredentialStore(),
  });
  const envelope = JSON.parse(capture.stderr());

  assert.equal(code, 2);
  assert.equal(capture.stdout(), '');
  assert.equal(validateError(envelope), true, JSON.stringify(validateError.errors));
});

test('每个业务命令的规范字段结果都通过发布 Schema', async () => {
  const cases = [
    {
      name: 'repo.list',
      argv: ['repo', 'list', '1'],
      response: [repoApiFixture],
    },
    {
      name: 'repo.view',
      argv: ['repo', 'view', '9001'],
      response: repoApiFixture,
    },
    {
      name: 'mr.list',
      argv: ['mr', 'list', '-R', '9001'],
      response: [mergeRequestApiFixture],
    },
    {
      name: 'mr.view',
      argv: ['mr', 'view', '17', '-R', '9001'],
      response: mergeRequestApiFixture,
    },
    {
      name: 'mr.commits',
      argv: ['mr', 'commits', '17', '-R', '9001'],
      response: [commitApiFixture],
    },
    {
      name: 'mr.comment.create',
      argv: [
        'mr',
        'comment',
        'create',
        '17',
        '-R',
        '9001',
        '--body-file',
        '-',
        '--confirm-write',
      ],
      response: commentApiFixture,
      readStdin: async () => 'review body',
    },
    {
      name: 'mr.comment.create dry-run',
      argv: [
        'mr',
        'comment',
        'create',
        '17',
        '-R',
        '9001',
        '--body-file',
        '-',
        '--confirm-write',
        '--dry-run',
      ],
      response: null,
      readStdin: async () => 'review body',
    },
  ];

  for (const item of cases) {
    const capture = captureIo();
    const code = await runCli(item.argv, {
      env: testEnv(),
      io: capture.io,
      configStore: new MemoryConfigStore(),
      credentialStore: new MemoryCredentialStore({
        authType: AUTH_TYPES.PRIVATE_TOKEN,
        token: 'schema-token',
        source: 'credential_helper',
      }),
      fetchImpl: async () => jsonResponse(item.response),
      readStdin: item.readStdin,
    });
    const envelope = JSON.parse(capture.stdout());

    assert.equal(code, 0, item.name);
    assert.equal(capture.stderr(), '', item.name);
    assert.equal(
      validateSuccess(envelope),
      true,
      `${item.name}: ${JSON.stringify(validateSuccess.errors)}`,
    );
  }
});

test('认证命令的成功结果都通过发布 Schema', async () => {
  const cases = [
    {
      name: 'auth.login',
      argv: ['auth', 'login', '--output', 'json'],
      interactive: true,
      promptLogin: async () => ({
        method: AUTH_TYPES.PRIVATE_TOKEN,
        token: 'new-token',
      }),
      store: new MemoryCredentialStore(),
    },
    {
      name: 'auth.status',
      argv: ['auth', 'status'],
      store: new MemoryCredentialStore({
        authType: AUTH_TYPES.PRIVATE_TOKEN,
        token: 'stored-token',
        source: 'credential_helper',
      }),
    },
    {
      name: 'auth.logout',
      argv: ['auth', 'logout'],
      store: new MemoryCredentialStore(),
    },
  ];

  for (const item of cases) {
    const capture = captureIo();
    const code = await runCli(item.argv, {
      env: testEnv(),
      io: capture.io,
      configStore: new MemoryConfigStore(),
      credentialStore: item.store,
      interactive: item.interactive,
      promptLogin: item.promptLogin,
    });
    const envelope = JSON.parse(capture.stdout());

    assert.equal(code, 0, item.name);
    assert.equal(
      validateSuccess(envelope),
      true,
      `${item.name}: ${JSON.stringify(validateSuccess.errors)}`,
    );
  }
});

test('配置初始化成功结果通过发布 Schema', async () => {
  const capture = captureIo();
  const code = await runCli(
    ['config', 'init', '--output', 'json', '--request-id', 'schema.config'],
    {
      env: testEnv(),
      io: capture.io,
      configStore: new MemoryConfigStore(),
      credentialStore: new MemoryCredentialStore(),
    },
  );
  const envelope = JSON.parse(capture.stdout());

  assert.equal(code, 0);
  assert.equal(envelope.command, 'config.init');
  assert.equal(validateSuccess(envelope), true, JSON.stringify(validateSuccess.errors));
});
