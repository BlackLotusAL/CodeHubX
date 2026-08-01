import { spawn } from 'node:child_process';
import { AUTH_TYPES } from './constants.js';
import { CliError } from './errors.js';

const USERNAME_BY_AUTH_TYPE = Object.freeze({
  [AUTH_TYPES.PRIVATE_TOKEN]: 'codehub-private-token',
  [AUTH_TYPES.X_AUTH_TOKEN]: 'codehub-x-auth-token',
});

export class GitCredentialStore {
  constructor({ env = process.env, runGit = defaultRunGit } = {}) {
    this.env = { ...env };
    this.runGit = runGit;
  }

  async get(host) {
    // Credential Helper 可能由桌面凭据管理器实现，串行调用可避免并发弹窗或锁冲突。
    const privateCredential = await this.#fill(
      host,
      AUTH_TYPES.PRIVATE_TOKEN,
    );
    const authCredential = await this.#fill(host, AUTH_TYPES.X_AUTH_TOKEN);

    if (privateCredential && authCredential) {
      throw new CliError(
        'CONFIG_CONFLICT',
        'Git Credential Helper 中同时存在两种 CodeHub 凭据，请重新登录以消除冲突。',
      );
    }

    return privateCredential || authCredential || null;
  }

  async save(host, authType, token) {
    await this.#assertHelperConfigured();
    const username = USERNAME_BY_AUTH_TYPE[authType];
    if (!username) {
      throw new CliError('CREDENTIAL_ERROR', '不支持的认证类型。');
    }

    const approveResult = await this.runGit(
      ['credential', 'approve'],
      credentialInput(host, username, token),
      this.env,
    );

    if (approveResult.code !== 0) {
      throw credentialFailure();
    }

    const verified = await this.#fill(host, authType);
    if (!verified || verified.token !== token) {
      throw new CliError(
        'CREDENTIAL_ERROR',
        'Git Credential Helper 未能持久化凭据。',
      );
    }

    const otherType =
      authType === AUTH_TYPES.PRIVATE_TOKEN
        ? AUTH_TYPES.X_AUTH_TOKEN
        : AUTH_TYPES.PRIVATE_TOKEN;
    await this.#reject(host, otherType);
  }

  async clear(host) {
    await this.#assertGitAvailable();
    await this.#reject(host, AUTH_TYPES.PRIVATE_TOKEN);
    await this.#reject(host, AUTH_TYPES.X_AUTH_TOKEN);
  }

  async #fill(host, authType) {
    const username = USERNAME_BY_AUTH_TYPE[authType];
    const result = await this.runGit(
      ['credential', 'fill'],
      credentialInput(host, username),
      this.env,
    );

    if (result.code !== 0) {
      return null;
    }

    const parsed = parseCredentialOutput(result.stdout);
    if (!parsed.password || parsed.username !== username) {
      return null;
    }

    return {
      authType,
      token: parsed.password,
      source: 'credential_helper',
    };
  }

  async #reject(host, authType) {
    const username = USERNAME_BY_AUTH_TYPE[authType];
    const result = await this.runGit(
      ['credential', 'reject'],
      credentialInput(host, username),
      this.env,
    );

    if (result.code !== 0) {
      throw credentialFailure();
    }
  }

  async #assertGitAvailable() {
    const result = await this.runGit(['--version'], '', this.env);
    if (result.code !== 0) {
      throw credentialFailure();
    }
  }

  async #assertHelperConfigured() {
    await this.#assertGitAvailable();
    const result = await this.runGit(
      ['config', '--get-all', 'credential.helper'],
      '',
      this.env,
    );

    if (result.code !== 0 || !result.stdout.trim()) {
      throw new CliError(
        'CREDENTIAL_ERROR',
        '未配置 Git Credential Helper，无法安全保存 CodeHub 凭据。',
      );
    }
  }
}

export async function resolveCredential({
  store,
  host,
  allowMissing = false,
}) {
  const stored = await store.get(host);
  if (stored) {
    return stored;
  }

  if (allowMissing) {
    return null;
  }

  throw new CliError(
    'AUTH_REQUIRED',
    '未找到 CodeHub 凭据，请由人类用户先执行 codehub auth login。',
  );
}

function credentialInput(host, username, password) {
  const lines = [
    'protocol=https',
    `host=${host}`,
    `username=${username}`,
  ];

  if (password !== undefined) {
    lines.push(`password=${password}`);
  }

  return `${lines.join('\n')}\n\n`;
}

function parseCredentialOutput(output) {
  const parsed = {};
  for (const line of String(output).split(/\r?\n/)) {
    const separator = line.indexOf('=');
    if (separator > 0) {
      parsed[line.slice(0, separator)] = line.slice(separator + 1);
    }
  }
  return parsed;
}

function credentialFailure() {
  return new CliError(
    'CREDENTIAL_ERROR',
    'Git Credential Helper 不可用或拒绝了凭据操作。',
  );
}

function defaultRunGit(args, input, env) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let child;

    try {
      const gitEnvironment = {
        ...env,
        GIT_TERMINAL_PROMPT: '0',
      };
      child = spawn('git', args, {
        env: gitEnvironment,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch {
      resolve({ code: 1, stdout: '', stderr: '' });
      return;
    }

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', () => {
      resolve({ code: 1, stdout: '', stderr: '' });
    });
    child.on('close', (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
    child.stdin.end(input);
  });
}
