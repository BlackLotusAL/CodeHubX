import { createApiClient } from './api.js';
import { createAuthenticationSession } from './authentication.js';
import { createConfigStore } from './config.js';
import { KeyringCredentialStore } from './credentials.js';
import { CliError, toCliError } from './errors.js';
import {
  createActivity,
  createProcessIo,
  writeFailure,
  writeSuccess,
} from './output.js';
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
  const authenticationFactory = dependencies.authenticationFactory ?? createAuthenticationSession;
  const activityFactory = dependencies.activityFactory ?? createActivity;
  const now = dependencies.now ?? Date.now;
  const signal = dependencies.signal;
  let executed = false;
  let selectedFormat = inferOutput(argv);

  const program = createProgram({
    io,
    execute: async (command, positionals, rawOptions) => {
      executed = true;
      selectedFormat = outputFormat(rawOptions.output ?? 'json');
      const timeoutMs = parseTimeout(rawOptions.timeout);
      if (signal?.aborted) throw new CliError('CANCELLED');

      const activity = activityFactory({
        ...(dependencies.activityOptions ?? {}),
        io,
        format: selectedFormat,
        command,
      });
      const authentication = authenticationFactory({
        configStore,
        credentialStore,
        prompter,
        clientFactory: apiFactory,
        timeoutMs,
        fetchImpl: dependencies.fetchImpl,
        now,
        signal,
      });
      const data = await activity.run(() => executeCommand({
        command,
        positionals,
        options: rawOptions,
        configStore,
        authentication,
      }));
      writeSuccess(io, selectedFormat, command, data, {
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
    writeFailure(io, selectedFormat, cliError);
    return cliError.exitCode;
  }
}

async function executeCommand(context) {
  switch (context.command) {
    case 'config.init':
      return context.configStore.init();
    case 'auth.login':
      return context.authentication.login();
    case 'auth.status':
      return context.authentication.status();
    case 'auth.logout':
      return context.authentication.logout();
    case 'repo.list': {
      const groupId = positiveId(context.positionals[0]);
      const { client: api } = await context.authentication.codehub();
      return projectRepoList(await api.listProjects(groupId));
    }
    case 'repo.view': {
      const projectId = positiveId(context.positionals[0]);
      const { client: api } = await context.authentication.codehub();
      return projectRepoView(await api.viewProject(projectId), projectId);
    }
    case 'mr.list': {
      const projectId = positiveId(context.options.projectId);
      const state = mergeRequestState(context.options.state);
      const { client: api } = await context.authentication.codehub();
      return projectMergeRequestList(await api.listMergeRequests(projectId, state), projectId);
    }
    case 'mr.view': {
      const projectId = positiveId(context.options.projectId);
      const iid = positiveId(context.positionals[0]);
      const { client: api } = await context.authentication.codehub();
      return projectMergeRequestView(await api.viewMergeRequest(projectId, iid), projectId, iid);
    }
    case 'mr.commits': {
      const projectId = positiveId(context.options.projectId);
      const iid = positiveId(context.positionals[0]);
      const { client: api } = await context.authentication.codehub();
      return projectCommitList(await api.listMergeRequestCommits(projectId, iid));
    }
    case 'mr.comment.create': {
      const projectId = positiveId(context.options.projectId);
      const iid = positiveId(context.positionals[0]);
      const body = commentBody(context.options.body);
      const selectedSeverity = severity(context.options.severity);
      const { client: api } = await context.authentication.codehub();
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

function inferOutput(argv) {
  const index = argv.indexOf('--output');
  if (index >= 0 && argv[index + 1] === 'human') return 'human';
  const assignment = argv.find((value) => value.startsWith('--output='));
  return assignment === '--output=human' ? 'human' : 'json';
}
