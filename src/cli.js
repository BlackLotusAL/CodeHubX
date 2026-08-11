import { createApiClient } from './api.js';
import { createConfigStore, requireCodehubConfig, requireDevucConfig } from './config.js';
import {
  KeyringCredentialStore,
  credentialSecrets,
  devucCredential,
  privateCredential,
} from './credentials.js';
import {
  AUTH_TYPES,
  DEVUC_REFRESH_LEEWAY_MS,
  DEVUC_VALIDITY_MS,
} from './constants.js';
import { CliError, toCliError } from './errors.js';
import { createProcessIo, writeFailure, writeSuccess } from './output.js';
import { createInteractivePrompter } from './prompts.js';
import { createProgram } from './program.js';
import {
  projectCommentResult,
  projectCommitList,
  projectMergeRequestList,
  projectMergeRequestView,
  projectRepoList,
  projectRepoView,
} from './transform.js';
import {
  commentBody,
  mergeRequestState,
  outputFormat,
  parseTimeout,
  positiveId,
  severity,
} from './validation.js';

export async function runCli(argv, dependencies = {}) {
  const io = dependencies.io ?? createProcessIo();
  const configStore = dependencies.configStore ?? createConfigStore();
  const credentialStore = dependencies.credentialStore ?? new KeyringCredentialStore();
  const prompter = dependencies.prompter ?? createInteractivePrompter();
  const apiFactory = dependencies.apiFactory ?? createApiClient;
  const now = dependencies.now ?? Date.now;
  const signal = dependencies.signal;
  const sensitiveValues = [];
  let executed = false;
  let selectedFormat = inferOutput(argv);

  const program = createProgram({
    io,
    execute: async (command, positionals, rawOptions) => {
      executed = true;
      selectedFormat = outputFormat(rawOptions.output ?? 'json');
      const timeoutMs = parseTimeout(rawOptions.timeout);
      if (signal?.aborted) throw new CliError('CANCELLED');

      const data = await executeCommand({
        command,
        positionals,
        options: rawOptions,
        timeoutMs,
        configStore,
        credentialStore,
        prompter,
        apiFactory,
        fetchImpl: dependencies.fetchImpl,
        now,
        signal,
        sensitiveValues,
      });
      writeSuccess(io, selectedFormat, command, data, {
        sensitiveValues,
        now,
      });
    },
  });

  try {
    await program.parseAsync(argv, { from: 'user' });
    if (!executed) throw new CliError('INVALID_ARGUMENT');
    return 0;
  } catch (error) {
    if (error?.code === 'commander.helpDisplayed') return 0;
    const cliError = toCliError(error);
    writeFailure(io, selectedFormat, cliError, { sensitiveValues });
    return cliError.exitCode;
  }
}

async function executeCommand(context) {
  switch (context.command) {
    case 'config.init':
      return context.configStore.init();
    case 'auth.login':
      return login(context);
    case 'auth.status':
      return authStatus(context);
    case 'auth.logout':
      return authLogout(context);
    case 'repo.list': {
      const groupId = positiveId(context.positionals[0]);
      const { api } = await authenticatedApi(context);
      return projectRepoList(await api.listProjects(groupId));
    }
    case 'repo.view': {
      const projectId = positiveId(context.positionals[0]);
      const { api } = await authenticatedApi(context);
      return projectRepoView(await api.viewProject(projectId), projectId);
    }
    case 'mr.list': {
      const projectId = positiveId(context.options.projectId);
      const state = mergeRequestState(context.options.state);
      const { api } = await authenticatedApi(context);
      return projectMergeRequestList(await api.listMergeRequests(projectId, state), projectId);
    }
    case 'mr.view': {
      const projectId = positiveId(context.options.projectId);
      const iid = positiveId(context.positionals[0]);
      const { api } = await authenticatedApi(context);
      return projectMergeRequestView(await api.viewMergeRequest(projectId, iid), projectId, iid);
    }
    case 'mr.commits': {
      const projectId = positiveId(context.options.projectId);
      const iid = positiveId(context.positionals[0]);
      const { api } = await authenticatedApi(context);
      return projectCommitList(await api.listMergeRequestCommits(projectId, iid));
    }
    case 'mr.comment.create': {
      const projectId = positiveId(context.options.projectId);
      const iid = positiveId(context.positionals[0]);
      const body = commentBody(context.options.body);
      const selectedSeverity = severity(context.options.severity);
      const { api } = await authenticatedApi(context);
      const response = await api.createMergeRequestComment(
        projectId,
        iid,
        body,
        selectedSeverity,
      );
      return projectCommentResult(response, {
        repoId: projectId,
        mrIid: iid,
        severity: selectedSeverity,
      });
    }
    default:
      throw new CliError('INVALID_ARGUMENT');
  }
}

async function login(context) {
  const rawConfig = await context.configStore.load();
  const codehub = requireCodehubConfig(rawConfig);
  remember(context, codehub.appCode);

  const authenticationType = await context.prompter.chooseAuthenticationType({
    signal: context.signal,
  });

  if (authenticationType === AUTH_TYPES.PRIVATE_TOKEN) {
    const token = await context.prompter.readPrivateToken({ signal: context.signal });
    remember(context, token);
    const credential = privateCredential(token);
    await context.credentialStore.save(codehub.origin, credential);
    return loginResult(codehub.origin, authenticationType);
  }

  if (authenticationType === AUTH_TYPES.DEVUC) {
    const devuc = requireDevucConfig(rawConfig);
    remember(context, devuc.appCode);
    const values = await context.prompter.readDevucCredentials({ signal: context.signal });
    remember(context, values.account, values.password);
    const api = context.apiFactory({
      devuc,
      timeoutMs: context.timeoutMs,
      fetchImpl: context.fetchImpl,
      signal: context.signal,
    });
    const token = await api.devucLogin(values.account, values.password);
    remember(context, token);
    const credential = devucCredential({
      account: values.account,
      password: values.password,
      token,
      issuedAtMs: context.now(),
    });
    await context.credentialStore.save(codehub.origin, credential);
    return loginResult(codehub.origin, authenticationType);
  }

  throw new CliError('INVALID_ARGUMENT');
}

async function authStatus(context) {
  const codehub = await loadCodehub(context);
  const credential = await context.credentialStore.get(codehub.origin);
  remember(context, ...credentialSecrets(credential));
  return {
    configured: Boolean(credential),
    authentication_type: credential?.authentication_type ?? null,
    api_host: codehub.origin,
  };
}

async function authLogout(context) {
  const codehub = await loadCodehub(context);
  await context.credentialStore.clear(codehub.origin);
  return {
    credential_helper_cleared: true,
    api_host: codehub.origin,
  };
}

async function authenticatedApi(context) {
  const rawConfig = await context.configStore.load();
  const codehub = requireCodehubConfig(rawConfig);
  remember(context, codehub.appCode);
  let credential = await context.credentialStore.get(codehub.origin);
  if (!credential) throw new CliError('AUTH_ERROR');
  remember(context, ...credentialSecrets(credential));

  if (
    credential.authentication_type === AUTH_TYPES.DEVUC &&
    context.now() >= credential.issued_at_ms + DEVUC_VALIDITY_MS - DEVUC_REFRESH_LEEWAY_MS
  ) {
    const devuc = requireDevucConfig(rawConfig);
    remember(context, devuc.appCode);
    const refreshApi = context.apiFactory({
      devuc,
      timeoutMs: context.timeoutMs,
      fetchImpl: context.fetchImpl,
      signal: context.signal,
    });
    const token = await refreshApi.devucLogin(credential.account, credential.password);
    remember(context, token);
    credential = devucCredential({
      account: credential.account,
      password: credential.password,
      token,
      issuedAtMs: context.now(),
    });
    await context.credentialStore.save(codehub.origin, credential);
  }

  return {
    api: context.apiFactory({
      codehub,
      credential,
      timeoutMs: context.timeoutMs,
      fetchImpl: context.fetchImpl,
      signal: context.signal,
    }),
    credential,
  };
}

async function loadCodehub(context) {
  const rawConfig = await context.configStore.load();
  const codehub = requireCodehubConfig(rawConfig);
  remember(context, codehub.appCode);
  return codehub;
}

function loginResult(origin, authenticationType) {
  return {
    configured: true,
    authentication_type: authenticationType,
    api_host: origin,
  };
}

function remember(context, ...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.length > 0) context.sensitiveValues.push(value);
  }
}

function inferOutput(argv) {
  const index = argv.indexOf('--output');
  if (index >= 0 && argv[index + 1] === 'human') return 'human';
  const assignment = argv.find((value) => value.startsWith('--output='));
  return assignment === '--output=human' ? 'human' : 'json';
}
