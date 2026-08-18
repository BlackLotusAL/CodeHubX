import { openSync } from 'node:fs';
import { WriteStream } from 'node:tty';
import { input as textInput, password, select } from '@inquirer/prompts';
import { AUTH_TYPES } from './constants.js';
import { CliError } from './errors.js';
import { devucAccount, devucPassword, privateToken } from './validation.js';

export function createInteractivePrompter({
  input = process.stdin,
  output,
  promptApi = { input: textInput, password, select },
} = {}) {
  return {
    async chooseAuthenticationType({ signal } = {}) {
      return runPrompt(async () => {
        const terminal = output ? { stream: output } : openTerminalOutput();
        assertInteractive(input, terminal.stream);
        try {
          return await promptApi.select(
            {
              message: '请选择认证方式',
              choices: [
                { name: 'Private Token', value: AUTH_TYPES.PRIVATE_TOKEN },
                { name: 'DevUC', value: AUTH_TYPES.DEVUC },
              ],
            },
            promptContext(input, terminal.stream, signal),
          );
        } finally {
          terminal.close?.();
        }
      });
    },

    async readPrivateToken({ signal } = {}) {
      return runPrompt(async () => {
        const terminal = output ? { stream: output } : openTerminalOutput();
        assertInteractive(input, terminal.stream);
        try {
          return await promptApi.password(
            {
              message: '请输入 Private Token',
              mask: true,
              validate: (value) =>
                validatePrompt(value, privateToken, 'Token 不能为空或包含换行符'),
            },
            promptContext(input, terminal.stream, signal),
          );
        } finally {
          terminal.close?.();
        }
      });
    },

    async readDevucCredentials({ signal } = {}) {
      return runPrompt(async () => {
        const terminal = output ? { stream: output } : openTerminalOutput();
        assertInteractive(input, terminal.stream);
        try {
          const account = await promptApi.input(
            {
              message: '请输入 DevUC 账号',
              validate: (value) => validatePrompt(value, devucAccount, '账号只能包含字母和数字'),
            },
            promptContext(input, terminal.stream, signal, false),
          );
          const value = await promptApi.password(
            {
              message: '请输入 DevUC 密码',
              mask: true,
              validate: (candidate) =>
                validatePrompt(candidate, devucPassword, '密码不能为空或包含换行符'),
            },
            promptContext(input, terminal.stream, signal),
          );
          return { account, password: value };
        } finally {
          terminal.close?.();
        }
      });
    },
  };
}

function promptContext(input, output, signal, clearPromptOnDone = true) {
  return { input, output, signal, clearPromptOnDone };
}

function assertInteractive(input, output) {
  if (!input?.isTTY || !output?.isTTY) throw new CliError('INVALID_ARGUMENT');
}

function validatePrompt(value, validator, message) {
  try {
    validator(value);
    return true;
  } catch {
    return message;
  }
}

async function runPrompt(callback) {
  try {
    return await callback();
  } catch (error) {
    if (
      error instanceof CliError ||
      error?.name === 'ExitPromptError' ||
      error?.name === 'AbortPromptError' ||
      error?.name === 'AbortError'
    ) {
      if (error instanceof CliError) throw error;
      throw new CliError('CANCELLED', { cause: error });
    }
    throw new CliError('CANCELLED', { cause: error });
  }
}

function openTerminalOutput() {
  const device = process.platform === 'win32' ? '\\\\.\\CONOUT$' : '/dev/tty';
  try {
    const fd = openSync(device, 'w');
    const stream = new WriteStream(fd);
    return { stream, close: () => stream.destroy() };
  } catch {
    return { stream: process.stderr };
  }
}
