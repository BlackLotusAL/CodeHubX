import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { readBodyFile, readStream } from '../src/input.js';

test('readStream 按 UTF-8 读取完整 stdin', async () => {
  const stream = Readable.from([
    Buffer.from('中文 '),
    Buffer.from('🚀\n'),
  ]);
  assert.equal(await readStream(stream), '中文 🚀\n');
});

test('正文文件保持空白与 Shell 特殊字符原样', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codehub-input-'));
  const path = join(directory, 'body.md');
  const body = '  \n$(echo untouched) `raw`\n';
  await writeFile(path, body, 'utf8');

  assert.equal(await readBodyFile(path, async () => ''), body);
});

test('零字节正文被本地拒绝，但纯空白正文允许交给服务端判断', async () => {
  await assert.rejects(readBodyFile('-', async () => ''), {
    code: 'INVALID_ARGUMENT',
  });
  assert.equal(await readBodyFile('-', async () => ' \n'), ' \n');
});
