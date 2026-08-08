import { randomUUID } from 'node:crypto';
import { arch, platform } from 'node:os';
import { createApiClient } from './api.js';
import { createConfigStore } from './config.js';
import {
  AUTH_TYPES,
  CLI_VERSION,
  SCHEMA_VERSION,
  WARNING,
} from './constants.js';
import {
  GitCredentialStore,
  resolveCredential,
} from './credentials.js';
import { CliError, toCliError } from './errors.js';
import { readBodyFile, readStream } from './input.js';
import {
  errorEnvelope,
  successEnvelope,
  writeError,
  writeSuccess,
} from './output.js';
import { createProgram } from './program.js';
import { runLoginPrompt } from './prompts.js';
import {
  createSimulationApiClient,
  SIMULATION_CONFIG,
  SIMULATION_CREDENTIAL,
} from './simulation.js';
import {
  projectCommentResult,
  projectCommitList,
  projectMergeRequestList,
  projectMergeRequestView,
  projectRepoList,
  projectRepoView,
  sanitiseForOutput,
} from './transform.js';
import {
  isValidRequestId,
  parsePositiveId,
  parseTimeout,
  validateAccount,
  validateOutput,
  validateRequestId,
  validateSeverity,
  validateState,
} from './validation.js';

export async function runCli(argv, dependencies = {}) {
  const env = dependencies.env ?? process.env;
  const stdoutStream = dependencies.stdoutStream ?? process.stdout;
  const stderrStream = dependencies.stderrStream ?? process.stderr;
  const io = dependencies.io ?? {
    stdout: (value) => stdoutStream.write(value),
    stderr: (value) => stderrStream.write(value),
  };
  const readStdin =
    dependencies.readStdin ?? (() => readStream(dependencies.stdin ?? process.stdin));
  const stdin = dependencies.stdin ?? process.stdin;
  const interactive =
    dependencies.interactive ?? Boolean(stdin.isTTY && stderrStream.isTTY);
  const outputOptions = {
    env,
    stdoutIsTTY:
      dependencies.stdoutIsTTY ??
      (dependencies.io ? false : Boolean(stdoutStream.isTTY)),
    stderrIsTTY:
      dependencies.stderrIsTTY ??
      (dependencies.io ? false : Boolean(stderrStream.isTTY)),
    columns: dependencies.columns ?? stdoutStream.columns ?? 100,
    now: dependencies.now ?? (() => new Date()),
  };
  const promptLogin =
    dependencies.promptLogin ??
    (() =>
      runLoginPrompt({
        input: stdin,
        output: stderrStream,
        signal: dependencies.signal,
        env,
      }));
  const credentialStore =
    dependencies.credentialStore ?? new GitCredentialStore({ env });
  const configStore =
    dependencies.configStore ??
    createConfigStore({
      env,
      platform: dependencies.platform ?? process.platform,
      homeDirectory: dependencies.homeDirectory,
    });
  const fallbackRequestId = inferredRequestId(argv) || createRequestId();
  const fallbackCommand = inferCommand(argv);
  const fallbackOutput = inferredOutput(argv, fallbackCommand);

  if (argv.length === 0) {
    const error = new CliError(
      'INVALID_ARGUMENT',
      '缺少命令，请使用 codehub --help 查看用法。',
    );
    writeError(
      io,
      fallbackOutput,
      errorEnvelope(fallbackCommand, fallbackRequestId, error),
      outputOptions,
    );
    return error.exitCode;
  }

  const execute = async (command, positional, rawOptions) => {
    const options = resolveGlobalOptions(rawOptions, command);
    const requestId = options.requestId ?? fallbackRequestId;
    const simulationEnabled = options.simulate && supportsSimulation(command);
    const config = simulationEnabled
      ? SIMULATION_CONFIG
      : requiresConfig(command)
        ? await configStore.load()
        : null;

    const context = {
      command,
      positional,
      options,
      requestId,
      config,
      configStore,
      io,
      readStdin,
      interactive,
      promptLogin,
      credentialStore,
      fetchImpl: dependencies.fetchImpl ?? globalThis.fetch,
      sleep: dependencies.sleep,
      random: dependencies.random,
      signal: dependencies.signal,
      sensitiveValues: new Set(
        [config?.codehub.appCode, config?.devuc.appCode].filter(Boolean),
      ),
    };

    const { data, warnings = [] } = await executeCommand(context);
    const outputWarnings = simulationEnabled
      ? [WARNING.SIMULATION_MODE, ...warnings]
      : warnings;
    const safeData = sanitiseForOutput(data, context.sensitiveValues);
    writeSuccess(
      io,
      options.output,
      successEnvelope(
        command,
        requestId,
        safeData,
        outputWarnings,
      ),
      outputOptions,
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
      outputOptions,
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

    case 'config.init': {
      if (options.simulate) {
        return {
          data: {
            created: false,
            config_path: '[simulation]/codehub/config.json',
          },
        };
      }
      const result = await context.configStore.init();
      return {
        data: {
          created: result.created,
          config_path: result.configPath,
        },
      };
    }

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
        data: projectRepoList(result.data),
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
        data: projectRepoView(result.data, projectId),
        warnings: retryWarnings(result.retryCount),
      };
    }

    case 'mr.list': {
      const projectId = requiredRepo(options);
      const state = validateState(options.state);
      const api = await authenticatedApi(context);
      const result = await api.listMergeRequests(projectId, state);
      return {
        data: projectMergeRequestList(result.data, projectId),
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
        data: projectMergeRequestView(result.data, projectId),
        warnings: retryWarnings(result.retryCount),
      };
    }

    case 'mr.commits': {
      const projectId = requiredRepo(options);
      const iid = parsePositiveId(positional[0], 'MR IID');
      const api = await authenticatedApi(context);
      const result = await api.listMergeRequestCommits(projectId, iid);
      return {
        data: projectCommitList(result.data),
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
  const { options, credentialStore, config } = context;
  if (options.simulate) {
    return {
      data: loginResult(config, SIMULATION_CREDENTIAL.authType, 'simulation'),
    };
  }
  if (options.noInput) {
    throw new CliError(
      'INVALID_ARGUMENT',
      'auth login 只允许人类在交互式终端中执行，不支持 --no-input。',
    );
  }
  if (!context.interactive) {
    throw new CliError(
      'INVALID_ARGUMENT',
      'auth login 需要交互式终端，请由人类用户在 Windows PowerShell 或 Linux 终端中执行。',
    );
  }

  const answers = await context.promptLogin();
  if (answers?.method === AUTH_TYPES.PRIVATE_TOKEN) {
    const token = answers.token;
    if (typeof token !== 'string' || token.length === 0) {
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
      config.codehub.host,
      AUTH_TYPES.PRIVATE_TOKEN,
      token,
    );

    return {
      data: loginResult(config, AUTH_TYPES.PRIVATE_TOKEN),
    };
  }

  if (answers?.method !== 'devuc') {
    throw new CliError(
      'INVALID_ARGUMENT',
      '不支持的认证方式。',
    );
  }
  const account = validateAccount(answers.account);
  let password = answers.password;
  if (typeof password !== 'string' || password.length === 0) {
    throw new CliError('INVALID_ARGUMENT', 'DevUC 密码不能为空。');
  }
  context.sensitiveValues.add(password);

  const api = apiFor(context, null);
  const result = await api.devucLogin(account, password);
  const token = result.data.result.newToken;
  context.sensitiveValues.add(token);
  password = undefined;
  await credentialStore.save(
    config.codehub.host,
    AUTH_TYPES.X_AUTH_TOKEN,
    token,
  );

  return {
    data: loginResult(config, AUTH_TYPES.X_AUTH_TOKEN),
  };
}

async function authStatus(context) {
  if (context.options.simulate) {
    return {
      data: {
        configured: true,
        credential_source: SIMULATION_CREDENTIAL.source,
        authentication_type: SIMULATION_CREDENTIAL.authType,
        api_host: context.config.codehub.origin,
      },
    };
  }
  const credential = await resolveCredential({
    store: context.credentialStore,
    host: context.config.codehub.host,
    allowMissing: true,
  });

  return {
    data: {
      configured: Boolean(credential),
      credential_source: credential?.source ?? null,
      authentication_type: credential?.authType ?? null,
      api_host: context.config.codehub.origin,
    },
  };
}

async function authLogout(context) {
  if (context.options.simulate) {
    return {
      data: {
        credential_helper_cleared: true,
        api_host: context.config.codehub.origin,
      },
    };
  }
  await context.credentialStore.clear(context.config.codehub.host);
  return {
    data: {
      credential_helper_cleared: true,
      api_host: context.config.codehub.origin,
    },
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
        repo_id: projectId,
        mr_iid: iid,
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
    data: projectCommentResult(result.data, {
      repoId: projectId,
      mrIid: iid,
      severity,
    }),
    warnings: [WARNING.UNSAFE_WRITE_GUARANTEES],
  };
}

async function authenticatedApi(context) {
  return apiFor(context, await getCredential(context));
}

async function getCredential(context) {
  if (context.options.simulate) {
    return SIMULATION_CREDENTIAL;
  }
  const credential = await resolveCredential({
    store: context.credentialStore,
    host: context.config.codehub.host,
  });
  context.sensitiveValues.add(credential.token);
  return credential;
}

function apiFor(context, credential) {
  if (context.options.simulate) {
    return createSimulationApiClient();
  }
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

function resolveGlobalOptions(options, command) {
  const output = validateOutput(
    options.output ?? (humanByDefault(command) ? 'human' : 'json'),
  );
  const requestId = options.requestId
    ? validateRequestId(options.requestId)
    : undefined;

  return {
    ...options,
    noInput: options.noInput === true || options.input === false,
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

function loginResult(config, authType, credentialSource = 'credential_helper') {
  return {
    configured: true,
    credential_source: credentialSource,
    authentication_type: authType,
    api_host: config.codehub.origin,
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

function inferredOutput(argv, command) {
  const output = optionValue(argv, '--output');
  if (output === 'human' || output === 'json') {
    return output;
  }
  return humanByDefault(command) ? 'human' : 'json';
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
    ['config', 'init'],
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

function requiresConfig(command) {
  return !new Set(['version', 'capabilities', 'config.init']).has(command);
}

function supportsSimulation(command) {
  return !new Set(['version', 'capabilities']).has(command);
}

function humanByDefault(command) {
  return command === 'auth.login' || command === 'config.init';
}
