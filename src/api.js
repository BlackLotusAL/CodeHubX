import { AUTH_TYPES, CLI_VERSION } from './constants.js';
import { requestJson } from './http.js';

export function createApiClient({
  config,
  credential,
  timeoutMs,
  fetchImpl,
  sleep,
  random,
  signal,
  onRetry,
}) {
  const common = {
    timeoutMs,
    fetchImpl,
    sleep,
    random,
    signal,
    onRetry,
  };

  const codeHubHeaders = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'User-Agent': `codehub/${CLI_VERSION} node/${process.versions.node} ${process.platform}`,
    'X-Apig-AppCode': config.apiAppCode,
    ...(credential?.authType === AUTH_TYPES.PRIVATE_TOKEN
      ? { 'private-token': credential.token }
      : {}),
    ...(credential?.authType === AUTH_TYPES.X_AUTH_TOKEN
      ? { 'X-Auth-token': credential.token }
      : {}),
  };

  return {
    devucLogin(account, password) {
      return requestJson({
        ...common,
        url: config.devucUrl,
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'User-Agent': codeHubHeaders['User-Agent'],
          'X-Apig-AppCode': config.devucAppCode,
        },
        body: { account, password },
        validate: (value) =>
          value !== null &&
          typeof value === 'object' &&
          value.status === 'ok' &&
          typeof value.result?.newToken === 'string' &&
          value.result.newToken.length > 0,
      });
    },

    listProjects(groupId) {
      return get(
        `/groups/${groupId}/projects`,
        (value) => Array.isArray(value),
      );
    },

    viewProject(projectId) {
      return get(
        `/projects/${projectId}`,
        (value) => isObject(value),
      );
    },

    listMergeRequests(projectId, state) {
      const query = new URLSearchParams({ state });
      return get(
        `/projects/${projectId}/isource/merge_requests?${query}`,
        (value) => Array.isArray(value),
      );
    },

    viewMergeRequest(projectId, iid) {
      return get(
        `/projects/${projectId}/isource/merge_requests/${iid}`,
        (value) => isObject(value),
      );
    },

    listMergeRequestCommits(projectId, iid) {
      return get(
        `/projects/${projectId}/merge_requests/${iid}/commits`,
        (value) => Array.isArray(value),
      );
    },

    createMergeRequestComment(projectId, iid, body, severity) {
      return requestJson({
        ...common,
        url: apiUrl(
          config.apiBaseUrl,
          `/projects/${projectId}/merge_requests/${iid}/discussions`,
        ),
        method: 'POST',
        headers: codeHubHeaders,
        body: { body, severity },
        validate: (value) => isObject(value),
        isWrite: true,
      });
    },
  };

  function get(path, validate) {
    return requestJson({
      ...common,
      url: apiUrl(config.apiBaseUrl, path),
      method: 'GET',
      headers: codeHubHeaders,
      validate,
    });
  }
}

function apiUrl(baseUrl, path) {
  return `${baseUrl.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
