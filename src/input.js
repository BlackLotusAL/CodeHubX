import { readFile } from 'node:fs/promises';
import { CliError } from './errors.js';

export async function readStream(stream = process.stdin) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

export async function readBodyFile(path, readStdin) {
  let body;
  try {
    body = path === '-' ? await readStdin() : await readFile(path, 'utf8');
  } catch {
    throw new CliError(
      'INVALID_ARGUMENT',
      path === '-' ? '无法从 stdin 读取评论正文。' : '无法读取评论正文文件。',
    );
  }

  if (Buffer.byteLength(body, 'utf8') === 0) {
    throw new CliError('INVALID_ARGUMENT', '评论正文不能为空。');
  }

  return body;
}
