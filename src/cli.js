import { randomUUID } from 'node:crypto';
import { arch, platform } from 'node:os';
import { createApiClient } from './api.js';
import { loadConfig } from './config.js';
import {
  AUTH_TYPES,
  CLI_VERSION,
  SCHEMA_VERSION,
  WARNING,
} from './constants.js';
import {
  GitCredentialStore,
  hasEnvironmentCredential,
  resolveCredential,
} from './credentials.js';
import { CliError, toCliError } from './errors.js';
import { readBodyFile, readHiddenInput, readStream } from './input.js';
import {
  errorEnvelope,
  successEnvelope,
  writeError,
  writeSuccess,
} from './output.js';
import { createProgram } from './program.js';
import { sanitiseForOutput, stringifyKnownIds } from './transform.js';
import {
  isValidRequestId,
  parsePositiveId,
  parseTimeout,
  stripOneTrailingNewline,
  validateAccount,
  validateOutput,
  validateRequestId,
  validateSeverity,
  validateState,
} from './validation.js';

export async function runCli(argv, dependencies = {}) {
  const env = dependencies.env ?? process.env;
  const io = dependencies.io ?? {
    stdout: (value) => process.stdout.write(value),
    stderr: (value) => process.stderr.write(value),
  };
  const readStdin =
    dependencies.readStdin ?? (() => readStream(dependencies.stdin ?? process.stdin));
  const hiddenInput =
    dependencies.readHidden ??
    (() =>
      readHiddenInput({
        input: dependencies.stdin ?? process.stdin,
        output: dependencies.stderrStream ?? process.stderr,
        signal: dependencies.signal,
      }));
  const credentialStore =
    dependencies.credentialStore ?? new GitCredentialStore({ env });
  const fallbackRequestId = inferredRequestId(argv) || createRequestId();
  const fallbackOutput = inferredOutput(argv);
  const fallbackCommand = inferCommand(argv);

  if (argv.length === 0) {
    const error = new CliError(
      'INVALID_ARGUMENT',
      '缺少命令，请使用 codehub --help 查看用法。',
    );
    writeError(
      io,
      fallbackOutput,
      errorEnvelope(fallbackCommand, fallbackRequestId, error),
    );
    return error.exitCode;
  }

  const execute = async (command, positional, rawOptions) => {
    const options = resolveGlobalOptions(rawOptions);
    const requestId = options.requestId ?? fallbackRequestId;
    const config =
      command === 'version' || command === 'capabilities'
        ? null
        : loadConfig(env);

    const context = {
      command,
      positional,
      options,
      requestId,
      config,
      env,
      io,
      readStdin,
      hiddenInput,
      credentialStore,
      fetchImpl: dependencies.fetchImpl ?? globalThis.fetch,
      sleep: dependencies.sleep,
      random: dependencies.random,
      signal: dependencies.signal,
      sensitiveValues: new Set([
        config?.apiAppCode,
        config?.devucAppCode,
        env.CODEHUB_PRIVATE_TOKEN,
        env.CODEHUB_AUTH_TOKEN,
      ]),
    };

    const { data, warnings = [] } = await executeCommand(context);
    const safeData = sanitiseForOutput(data, context.sensitiveValues);
    writeSuccess(
      io,
      options.output,
      successEnvelope(
        command,
        requestId,
        stringifyKnownIds(safeData),
        warnings,
      ),
    );
  };

  const program = createProgram({ execute, io });
  try {
    await program.parseAsync(argv, { from: 'user' });
    return 0;
  } catch (caught) {
    if (
      caught?.code === 'commander.helpDisplayed' ||
      caught?.code === 'commander.version'
    ) {
      return 0;
    }

    const error = toCliError(caught);
    writeError(
      io,
      fallbackOutput,
      errorEnvelope(fallbackCommand, fallbackRequestId, error),
    );
    return error.exitCode;
  }
}

async function executeCommand(context) {
  const { command, positional, options } = context;
  const repoOptionCommands = new Set([
    'mr.list',
    'mr.view',
    'mr.commits',
    'mr.comment.create',
  ]);
  if (options.repo && !repoOptionCommands.has(command)) {
    throw new CliError(
      'INVALID_ARGUMENT',
      '-R/--repo 仅适用于 MVP 的 Merge Request 命令。',
    );
  }

  switch (command) {
    case 'version':
      return {
        data: {
          cli_version: CLI_VERSION,
          protocol_version: SCHEMA_VERSION,
          node_version: process.versions.node,
          platform: platform(),
          arch: arch(),
        },
      };

    case 'capabilities':
      return {
        data: {
          authentication_methods: ['private_token', 'devuc'],
          read_commands: [
            'repo.list',
            'repo.view',
            'mr.list',
            'mr.view',
            'mr.commits',
          ],
          write_commands: ['mr.comment.create'],
          pagination_guaranteed: false,
          conditional_write: false,
          idempotent_write: false,
          inline_discussion: false,
          write_requires_confirmation: true,
          write_auto_retry: false,
        },
      };

    case 'auth.login':
      return login(context);

    case 'auth.status':
      return authStatus(context);

    case 'auth.logout':
      return authLogout(context);

    case 'repo.list': {
      const groupId = parsePositiveId(positional[0], 'Group ID');
      const api = await authenticatedApi(context);
      const result = await api.listProjects(groupId);
      return {
        data: result.data,
        warnings: [
          WARNING.PARTIAL_LIST_POSSIBLE,
          ...retryWarnings(result.retryCount),
        ],
      };
    }

    case 'repo.view': {
      const projectId = parsePositiveId(positional[0], 'Project ID');
      const api = await authenticatedApi(context);
      const result = await api.viewProject(projectId);
      return {
        data: result.data,
        warnings: retryWarnings(result.retryCount),
      };
    }

    case 'mr.list': {
      const projectId = requiredRepo(options);
      const state = validateState(options.state);
      const api = await authenticatedApi(context);
      const result = await api.listMergeRequests(projectId, state);
      return {
        data: result.data,
        warnings: [
          WARNING.PARTIAL_LIST_POSSIBLE,
          ...retryWarnings(result.retryCount),
        ],
      };
    }

    case 'mr.view': {
      const projectId = requiredRepo(options);
      const iid = parsePositiveId(positional[0], 'MR IID');
      const api = await authenticatedApi(context);
      const result = await api.viewMergeRequest(projectId, iid);
      return {
        data: result.data,
        warnings: retryWarnings(result.retryCount),
      };
    }

    case 'mr.commits': {
      const projectId = requiredRepo(options);
      const iid = parsePositiveId(positional[0], 'MR IID');
      const api = await authenticatedApi(context);
      const result = await api.listMergeRequestCommits(projectId, iid);
      return {
        data: result.data,
        warnings: retryWarnings(result.retryCount),
      };
    }

    case 'mr.comment.create':
      return createComment(context);

    default:
      throw new CliError('UNSUPPORTED_CAPABILITY', '当前 CLI 不支持该命令。');
  }
}

async function login(context) {
  const { options, credentialStore, config, readStdin, hiddenInput } = context;
  if (options.withToken === options.devuc) {
    throw new CliError(
      'INVALID_ARGUMENT',
      '必须且只能选择 --with-token 或 --devuc。',
    );
  }

  if (options.withToken) {
    if (options.account || options.passwordStdin) {
      throw new CliError(
        'INVALID_ARGUMENT',
        '--account 和 --password-stdin 仅适用于 --devuc。',
      );
    }

    const token = stripOneTrailingNewline(await readStdin());
    if (token.length === 0) {
      throw new CliError('INVALID_ARGUMENT', 'private token 不能为空。');
    }
    if (/[\r\n]/.test(token)) {
      throw new CliError(
        'INVALID_ARGUMENT',
        'private token 不能包含换行符。',
      );
    }
    context.sensitiveValues.add(token);
    await credentialStore.save(
      config.apiHost,
      AUTH_TYPES.PRIVATE_TOKEN,
      token,
    );

    return {
      data: loginResult(config, AUTH_TYPES.PRIVATE_TOKEN),
    };
  }

  const account = validateAccount(options.account);
  let password;
  if (options.passwordStdin) {
    password = stripOneTrailingNewline(await readStdin());
  } else if (options.noInput) {
    throw new CliError(
      'INVALID_ARGUMENT',
      '--no-input 模式下必须使用 --password-stdin 提供 DevUC 密码。',
    );
  } else {
    password = await hiddenInput();
  }

  if (password.length === 0) {
    throw new CliError('INVALID_ARGUMENT', 'DevUC 密码不能为空。');
  }

  const api = apiFor(context, null);
  const result = await api.devucLogin(account, password);
  const token = result.data.result.newToken;
  context.sensitiveValues.add(password);
  context.sensitiveValues.add(token);
  password = undefined;
  await credentialStore.save(config.apiHost, AUTH_TYPES.X_AUTH_TOKEN, token);

  return {
    data: loginResult(config, AUTH_TYPES.X_AUTH_TOKEN),
  };
}

async function authStatus(context) {
  const credential = await resolveCredential({
    env: context.env,
    store: context.credentialStore,
    host: context.config.apiHost,
    allowMissing: true,
  });

  return {
    data: {
      configured: Boolean(credential),
      credential_source: credential?.source ?? null,
      authentication_type: credential?.authType ?? null,
      api_host: context.config.apiOrigin,
      verified: false,
    },
    warnings: credential ? [WARNING.CREDENTIAL_NOT_VERIFIED] : [],
  };
}

async function authLogout(context) {
  await context.credentialStore.clear(context.config.apiHost);
  const environmentCredentialActive = hasEnvironmentCredential(context.env);
  return {
    data: {
      credential_helper_cleared: true,
      environment_credential_active: environmentCredentialActive,
      api_host: context.config.apiOrigin,
    },
    warnings: environmentCredentialActive
      ? [WARNING.ENV_CREDENTIAL_STILL_ACTIVE]
      : [],
  };
}

async function createComment(context) {
  const { options, positional } = context;
  if (!options.confirmWrite) {
    throw new CliError(
      'POLICY_DENIED',
      '创建评论必须显式提供 --confirm-write。',
    );
  }

  const projectId = requiredRepo(options);
  const iid = parsePositiveId(positional[0], 'MR IID');
  const severity = validateSeverity(options.severity);
  const body = await readBodyFile(options.bodyFile, context.readStdin);
  const credential = await getCredential(context);

  if (options.dryRun) {
    return {
      data: {
        dry_run: true,
        project_id: projectId,
        merge_request_iid: iid,
        severity,
        body_utf8_bytes: Buffer.byteLength(body, 'utf8'),
        authentication_type: credential.authType,
      },
    };
  }

  const result = await apiFor(context, credential).createMergeRequestComment(
    projectId,
    iid,
    body,
    severity,
  );
  return {
    data: result.data,
    warnings: [WARNING.UNSAFE_WRITE_GUARANTEES],
  };
}

async function authenticatedApi(context) {
  return apiFor(context, await getCredential(context));
}

async function getCredential(context) {
  const credential = await resolveCredential({
    env: context.env,
    store: context.credentialStore,
    host: context.config.apiHost,
  });
  context.sensitiveValues.add(credential.token);
  return credential;
}

function apiFor(context, credential) {
  return createApiClient({
    config: context.config,
    credential,
    timeoutMs: context.options.timeoutMs,
    fetchImpl: context.fetchImpl,
    sleep: context.sleep,
    random: context.random,
    signal: context.signal,
    onRetry:
      context.options.output === 'human'
        ? ({ attempt, delay, reason }) => {
            context.io.stderr(
              `读取请求重试 ${attempt}/2（${reason}，等待 ${delay}ms）\n`,
            );
          }
        : undefined,
  });
}

function resolveGlobalOptions(options) {
  const output = validateOutput(options.output);
  const requestId = options.requestId
    ? validateRequestId(options.requestId)
    : undefined;

  return {
    ...options,
    output,
    requestId,
    timeoutMs: parseTimeout(options.timeout),
  };
}

function requiredRepo(options) {
  if (!options.repo) {
    throw new CliError(
      'INVALID_ARGUMENT',
      '该命令必须提供 -R 或 --repo 指定 Project ID。',
    );
  }
  return parsePositiveId(options.repo, 'Project ID');
}

function loginResult(config, authType) {
  return {
    configured: true,
    credential_source: 'credential_helper',
    authentication_type: authType,
    api_host: config.apiOrigin,
  };
}

function retryWarnings(retryCount) {
  return retryCount > 0
    ? [
        {
          code: 'REQUEST_RETRIED',
          message: `读取请求在成功前重试了 ${retryCount} 次。`,
          details: { retry_count: retryCount },
        },
      ]
    : [];
}

function createRequestId() {
  return `req-${randomUUID()}`;
}

function inferredRequestId(argv) {
  const value = optionValue(argv, '--request-id');
  return isValidRequestId(value) ? value : null;
}

function inferredOutput(argv) {
  return optionValue(argv, '--output') === 'human' ? 'human' : 'json';
}

function optionValue(argv, name) {
  const index = argv.findIndex(
    (argument) => argument === name || argument.startsWith(`${name}=`),
  );
  if (index === -1) {
    return null;
  }

  return argv[index].includes('=')
    ? argv[index].slice(argv[index].indexOf('=') + 1)
    : argv[index + 1];
}

function inferCommand(argv) {
  const known = [
    ['mr', 'comment', 'create'],
    ['auth', 'login'],
    ['auth', 'status'],
    ['auth', 'logout'],
    ['repo', 'list'],
    ['repo', 'view'],
    ['mr', 'list'],
    ['mr', 'view'],
    ['mr', 'commits'],
    ['version'],
    ['capabilities'],
  ];

  for (const path of known) {
    let cursor = -1;
    let matches = true;
    for (const segment of path) {
      cursor = argv.indexOf(segment, cursor + 1);
      if (cursor === -1) {
        matches = false;
        break;
      }
    }
    if (matches) {
      return path.join('.');
    }
  }
  return 'unknown';
}
