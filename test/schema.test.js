import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import Ajv2020 from 'ajv/dist/2020.js';
import { runCli } from '../src/cli.js';
import {
  captureIo,
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
    credentialStore: new MemoryCredentialStore(),
  });
  const envelope = JSON.parse(capture.stderr());

  assert.equal(code, 2);
  assert.equal(capture.stdout(), '');
  assert.equal(validateError(envelope), true, JSON.stringify(validateError.errors));
});
