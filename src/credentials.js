import { spawn } from 'node:child_process';
import { AUTH_TYPES } from './constants.js';
import { CliError } from './errors.js';

const CREDENTIAL_USERNAME = 'codehub-cli';
const CREDENTIAL_RECORD_PREFIX = 'codehub-cli/v1:';
const LEGACY_USERNAME_BY_AUTH_TYPE = Object.freeze({
  [AUTH_TYPES.X_AUTH_TOKEN]: 'codehub-x-auth-token',
  [AUTH_TYPES.PRIVATE_TOKEN]: 'codehub-private-token',
});
const CREDENTIAL_COMMAND = Object.freeze([
  '-c',
  'credential.interactive=false',
  '-c',
  'credential.helper=!f() { echo quit=1; }; f',
  'credential',
]);
const DISABLED_ASKPASS =
  process.platform === 'win32'
    ? 'C:\\__codehub-no-interactive-askpass__.exe'
    : '/__codehub-no-interactive-askpass__';

export class GitCredentialStore {
  constructor({ env = process.env, runGit = defaultRunGit } = {}) {
    this.env = nonInteractiveEnvironment(env);
    this.runGit = runGit;
  }

  async get(host) {
    const stored = await this.#fill(host, CREDENTIAL_USERNAME);
    if (stored) {
      return credentialFromRecord(stored.password);
    }

    return this.#readAndMigrateLegacyCredential(host);
  }

  async save(host, authType, token) {
    await this.#assertHelperConfigured();
    await this.#storeCanonical(host, authType, token);
    await this.#clearUsernames(
      host,
      Object.values(LEGACY_USERNAME_BY_AUTH_TYPE),
    );
  }

  async clear(host) {
    await this.#assertGitAvailable();
    await this.#clearUsernames(host, [
      CREDENTIAL_USERNAME,
      ...Object.values(LEGACY_USERNAME_BY_AUTH_TYPE),
    ]);
  }

  async #storeCanonical(host, authType, token) {
    const record = serialiseCredentialRecord(authType, token);
    const approveResult = await this.runGit(
      [...CREDENTIAL_COMMAND, 'approve'],
      credentialInput(host, CREDENTIAL_USERNAME, record),
      this.env,
    );

    if (approveResult.code !== 0) {
      throw credentialFailure();
    }

    const verified = await this.#fill(host, CREDENTIAL_USERNAME);
    if (!verified || verified.password !== record) {
      throw new CliError(
        'CREDENTIAL_ERROR',
        'Git Credential Helper 未能持久化凭据。',
      );
    }
  }

  async #fill(host, username) {
    const result = await this.runGit(
      [...CREDENTIAL_COMMAND, 'fill'],
      credentialInput(host, username),
      this.env,
    );

    if (result.code !== 0) {
      return null;
    }

    const parsed = parseCredentialOutput(result.stdout);
    if (
      typeof parsed.password !== 'string' ||
      parsed.password.length === 0 ||
      parsed.username !== username
    ) {
      return null;
    }

    return parsed;
  }

  async #readAndMigrateLegacyCredential(host) {
    const credentials = [];
    for (const [authType, username] of Object.entries(
      LEGACY_USERNAME_BY_AUTH_TYPE,
    )) {
      const stored = await this.#fill(host, username);
      if (stored) {
        credentials.push({
          authType,
          token: stored.password,
          source: 'credential_helper',
        });
      }
    }

    if (credentials.length > 1) {
      throw new CliError(
        'CONFIG_CONFLICT',
        'Git Credential Helper 中同时存在两种旧版 CodeHub 凭据，请重新登录以消除冲突。',
      );
    }

    const credential = credentials[0] ?? null;
    if (credential) {
      await this.#migrateLegacyCredential(host, credential);
    }
    return credential;
  }

  async #migrateLegacyCredential(host, credential) {
    try {
      await this.#storeCanonical(
        host,
        credential.authType,
        credential.token,
      );
      await this.#clearUsernames(
        host,
        Object.values(LEGACY_USERNAME_BY_AUTH_TYPE),
      );
    } catch {
      // 迁移失败不能阻止本次命令使用仍然有效的旧凭据。
    }
  }

  async #clearUsernames(host, usernames) {
    let failed = false;
    for (const username of usernames) {
      const result = await this.runGit(
        [...CREDENTIAL_COMMAND, 'reject'],
        credentialInput(host, username),
        this.env,
      );
      failed ||= result.code !== 0;
    }
    if (failed) {
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

function serialiseCredentialRecord(authType, token) {
  if (!Object.values(AUTH_TYPES).includes(authType)) {
    throw new CliError('CREDENTIAL_ERROR', '不支持的认证类型。');
  }
  if (
    typeof token !== 'string' ||
    token.length === 0 ||
    /[\r\n\0]/.test(token)
  ) {
    throw new CliError('CREDENTIAL_ERROR', '认证 token 格式无效。');
  }

  const payload = Buffer.from(
    JSON.stringify({ auth_type: authType, token }),
    'utf8',
  ).toString('base64url');
  return `${CREDENTIAL_RECORD_PREFIX}${payload}`;
}

function credentialFromRecord(record) {
  try {
    if (!record.startsWith(CREDENTIAL_RECORD_PREFIX)) {
      throw new Error('UNKNOWN_RECORD_VERSION');
    }
    const payload = record.slice(CREDENTIAL_RECORD_PREFIX.length);
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (
      !Object.values(AUTH_TYPES).includes(parsed.auth_type) ||
      typeof parsed.token !== 'string' ||
      parsed.token.length === 0 ||
      /[\r\n\0]/.test(parsed.token)
    ) {
      throw new Error('INVALID_RECORD');
    }
    return {
      authType: parsed.auth_type,
      token: parsed.token,
      source: 'credential_helper',
    };
  } catch (error) {
    throw new CliError(
      'CREDENTIAL_ERROR',
      'CodeHub 凭据记录无效，请由人类用户重新执行 codehub auth login。',
      { cause: error },
    );
  }
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
      child = spawn('git', args, {
        env: nonInteractiveEnvironment(env),
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

function nonInteractiveEnvironment(env) {
  return {
    ...env,
    GIT_TERMINAL_PROMPT: '0',
    GIT_ASKPASS: DISABLED_ASKPASS,
    GCM_INTERACTIVE: '0',
    GCM_PROVIDER: 'generic',
  };
}
