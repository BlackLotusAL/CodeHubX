import { AUTH_TYPES } from './constants.js';

const SIMULATION_HOST = 'codehub.simulation.invalid';
const SIMULATION_ORIGIN = `https://${SIMULATION_HOST}`;
const FIXED_TIMESTAMP = '2026-08-01T08:00:00Z';

export const SIMULATION_CONFIG = Object.freeze({
  devuc: Object.freeze({
    endpoint: `${SIMULATION_ORIGIN}/devuc/token`,
    appCode: 'simulation-app-code',
  }),
  codehub: Object.freeze({
    endpoint: `${SIMULATION_ORIGIN}/api/v4`,
    appCode: 'simulation-app-code',
    origin: SIMULATION_ORIGIN,
    host: SIMULATION_HOST,
  }),
});

export const SIMULATION_CREDENTIAL = Object.freeze({
  authType: AUTH_TYPES.PRIVATE_TOKEN,
  token: 'simulation-token',
  source: 'simulation',
});

export function createSimulationApiClient() {
  return {
    async devucLogin() {
      return result({
        status: 'ok',
        result: { newToken: SIMULATION_CREDENTIAL.token },
      });
    },

    async listProjects() {
      return result([
        projectFixture('9001', 'reviewx/demo-service'),
        projectFixture('9002', 'reviewx/archived-service', {
          archived: true,
          updatedAt: '2026-07-15T03:00:00Z',
        }),
      ]);
    },

    async viewProject(projectId) {
      return result(projectFixture(projectId, `reviewx/project-${projectId}`));
    },

    async listMergeRequests(projectId, state) {
      const mergeRequests = [
        mergeRequestFixture(projectId, '17', {
          title: 'feat: add deterministic review workflow',
          state: 'opened',
        }),
        mergeRequestFixture(projectId, '18', {
          title: 'draft: refine agent review prompts',
          state: 'opened',
          isDraft: true,
          sourceBranch: 'draft/agent-prompts',
        }),
        mergeRequestFixture(projectId, '16', {
          title: 'fix: preserve structured CLI output',
          state: 'merged',
          sourceBranch: 'fix/structured-output',
        }),
        mergeRequestFixture(projectId, '15', {
          title: 'chore: remove obsolete test adapter',
          state: 'closed',
          sourceBranch: 'chore/remove-adapter',
        }),
        mergeRequestFixture(projectId, '14', {
          title: 'test: exercise locked review state',
          state: 'locked',
          sourceBranch: 'test/locked-state',
        }),
      ];

      return result(
        state === 'all'
          ? mergeRequests
          : mergeRequests.filter((mergeRequest) => mergeRequest.state === state),
      );
    },

    async viewMergeRequest(projectId, iid) {
      return result(
        mergeRequestFixture(projectId, iid, {
          title: `feat: simulated merge request ${iid}`,
          description:
            '这是 CodeHub CLI 内置的确定性仿真数据，用于验证代码检视 Agent 的读取流程。',
          labels: ['simulation', 'review-ready'],
        }),
      );
    },

    async listMergeRequestCommits(projectId, iid) {
      return result([
        commitFixture(
          '0123456789abcdef0123456789abcdef01234567',
          `feat: prepare simulated MR ${iid}`,
        ),
        commitFixture(
          '89abcdef0123456789abcdef0123456789abcdef',
          `test: cover project ${projectId} review flow`,
          '0123456789abcdef0123456789abcdef01234567',
        ),
      ]);
    },

    async createMergeRequestComment(projectId, iid, _body, severity) {
      return result({
        id: `simulation-discussion-${projectId}-${iid}`,
        project_id: projectId,
        severity,
        resolved: false,
        web_url: `${SIMULATION_ORIGIN}/projects/${projectId}/merge_requests/${iid}#simulation-comment`,
      });
    },
  };
}

function result(data) {
  return { data, retryCount: 0 };
}

function projectFixture(
  projectId,
  fullName,
  { archived = false, updatedAt = FIXED_TIMESTAMP } = {},
) {
  return {
    id: projectId,
    name: fullName.split('/').at(-1),
    name_with_namespace: fullName,
    path_with_namespace: fullName,
    archived,
    ssh_url_to_repo: `git@${SIMULATION_HOST}:${fullName}.git`,
    http_url_to_repo: `${SIMULATION_ORIGIN}/${fullName}.git`,
    updated_at: updatedAt,
    last_activity_at: updatedAt,
    default_branch: 'main',
    web_url: `${SIMULATION_ORIGIN}/${fullName}`,
  };
}

function mergeRequestFixture(
  projectId,
  iid,
  {
    title = `feat: simulated merge request ${iid}`,
    description = 'Deterministic CodeHub CLI simulation fixture.',
    state = 'opened',
    isDraft = false,
    sourceBranch = `feature/simulated-${iid}`,
    labels = ['simulation'],
  } = {},
) {
  return {
    id: `simulation-mr-${projectId}-${iid}`,
    iid,
    project_id: projectId,
    title,
    description,
    state,
    work_in_progress: isDraft,
    target_branch: 'main',
    source_branch: sourceBranch,
    author: {
      id: '1001',
      username: 'simulation-bot',
      name: 'Simulation Bot',
      type: 'user',
    },
    labels,
    changes_count: '3',
    added_lines: 42,
    removed_lines: 7,
    created_at: '2026-07-31T08:00:00Z',
    updated_at: FIXED_TIMESTAMP,
    web_url: `${SIMULATION_ORIGIN}/projects/${projectId}/merge_requests/${iid}`,
  };
}

function commitFixture(sha, title, parentSha = null) {
  return {
    id: sha,
    title,
    message: `${title}\n\nGenerated by the CodeHub CLI simulation mode.`,
    author_name: 'Simulation Developer',
    author_email: 'developer@simulation.invalid',
    committer_name: 'Simulation CI',
    committer_email: 'ci@simulation.invalid',
    authored_date: '2026-08-01T07:30:00Z',
    committed_date: FIXED_TIMESTAMP,
    parent_ids: parentSha ? [parentSha] : [],
  };
}
