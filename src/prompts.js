import {
  input as inputPrompt,
  password as passwordPrompt,
  select,
} from '@inquirer/prompts';
import { AUTH_TYPES } from './constants.js';
import { CliError } from './errors.js';

export async function runLoginPrompt({
  input = process.stdin,
  output = process.stderr,
  signal,
  env = process.env,
} = {}) {
  const colors = createColors(
    Boolean(output.isTTY) && !('NO_COLOR' in env) && env.TERM !== 'dumb',
  );
  const promptContext = {
    input,
    output,
    clearPromptOnDone: false,
    ...(signal ? { signal } : {}),
  };
  const theme = {
    prefix: {
      idle: colors.cyan('◆'),
      done: colors.green('✔'),
    },
    icon: {
      cursor: colors.cyan('>'),
    },
    style: {
      answer: colors.green,
      description: colors.dim,
      error: colors.red,
      help: colors.dim,
      highlight: colors.cyan,
      key: colors.cyan,
      keysHelpTip: () => undefined,
      message: colors.bold,
    },
  };

  output.write(
    `\n${colors.bold(colors.cyan('CodeHub 登录'))}\n${colors.dim('使用 ↑/↓ 选择，Enter 确认，Ctrl+C 取消')}\n\n`,
  );

  try {
    const method = await select(
      {
        message: '请选择认证方式',
        choices: [
          {
            name: 'Private Token',
            value: AUTH_TYPES.PRIVATE_TOKEN,
            description: '使用 CodeHub 个人访问令牌',
          },
          {
            name: 'DevUC 账号',
            value: 'devuc',
            description: '使用账号和密码换取 X-Auth-token',
          },
        ],
        loop: false,
        theme,
      },
      promptContext,
    );

    if (method === AUTH_TYPES.PRIVATE_TOKEN) {
      const token = await passwordPrompt(
        {
          message: '请输入 Private Token',
          mask: '*',
          validate: required('请输入 Private Token'),
          theme,
        },
        promptContext,
      );
      return { method, token };
    }

    const account = await inputPrompt(
      {
        message: '请输入 DevUC 账号',
        validate: (value) =>
          /^[A-Za-z0-9]+$/.test(value)
            ? true
            : '账号只能包含字母和数字',
        theme,
      },
      promptContext,
    );
    const password = await passwordPrompt(
      {
        message: '请输入 DevUC 密码',
        mask: '*',
        validate: required('请输入 DevUC 密码'),
        theme,
      },
      promptContext,
    );
    return { method: 'devuc', account, password };
  } catch (error) {
    if (
      error?.name === 'ExitPromptError' ||
      error?.name === 'AbortPromptError' ||
      signal?.aborted
    ) {
      throw new CliError('CANCELLED', '用户取消了登录。', {
        cause: error,
      });
    }
    throw error;
  }
}

function required(message) {
  return (value) => (value.length > 0 ? true : message);
}

function createColors(enabled) {
  const color = (open, close) =>
    enabled
      ? (value) => `\u001B[${open}m${value}\u001B[${close}m`
      : String;
  return {
    bold: color(1, 22),
    cyan: color(36, 39),
    dim: color(2, 22),
    green: color(32, 39),
    red: color(31, 39),
  };
}
