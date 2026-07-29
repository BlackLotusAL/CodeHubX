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

export function readHiddenInput({
  input = process.stdin,
  output = process.stderr,
  signal,
  prompt = 'DevUC 密码: ',
} = {}) {
  if (!input.isTTY || !output.isTTY || typeof input.setRawMode !== 'function') {
    throw new CliError(
      'INVALID_ARGUMENT',
      '当前终端不支持隐藏输入，请使用 --password-stdin。',
    );
  }

  return new Promise((resolve, reject) => {
    let value = '';
    const previousRawMode = input.isRaw;

    const cleanup = () => {
      input.off('data', onData);
      signal?.removeEventListener('abort', onAbort);
      input.setRawMode(Boolean(previousRawMode));
      input.pause();
    };

    const onAbort = () => {
      cleanup();
      output.write('\n');
      reject(new CliError('CANCELLED', '用户取消了操作。'));
    };

    const onData = (chunk) => {
      const text = String(chunk);
      for (const character of text) {
        if (character === '\u0003') {
          onAbort();
          return;
        }
        if (character === '\r' || character === '\n') {
          cleanup();
          output.write('\n');
          resolve(value);
          return;
        }
        if (character === '\u007f' || character === '\b') {
          value = value.slice(0, -1);
          continue;
        }
        value += character;
      }
    };

    output.write(prompt);
    input.setRawMode(true);
    input.resume();
    input.setEncoding('utf8');
    input.on('data', onData);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
