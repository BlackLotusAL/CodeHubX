import { AUTH_TYPES } from './constants.js';
import { CliError } from './errors.js';
import { requestJson } from './http.js';

export function createApiClient({
  codehub,
  devuc,
  credential,
  timeoutMs,
  fetchImpl,
  signal,
} = {}) {
  const common = { timeoutMs, fetchImpl, signal };

  return {
    async devucLogin(account, password) {
      if (!devuc) throw new CliError('CONFIG_ERROR');
      try {
        const data = await requestJson({
          ...common,
          url: devuc.endpoint,
          method: 'POST',
          headers: {
            'X-Apig-AppCode': devuc.appCode,
            'Content-Type': 'application/json',
          },
          body: { account, password },
          validate: isObject,
        });
        const token = data?.result?.newToken;
        if (typeof token !== 'string' || token.length === 0 || /[\r\n\0]/.test(token)) {
          throw new CliError('AUTH_ERROR');
        }
        return token;
      } catch (error) {
        if (error instanceof CliError && error.code === 'CANCELLED') throw error;
        throw new CliError('AUTH_ERROR', {
          cause: error,
          httpStatus: error?.httpStatus ?? null,
        });
      }
    },

    listProjects(groupId) {
      return get(`/groups/${encodeURIComponent(groupId)}/projects`, Array.isArray);
    },

    viewProject(projectId) {
      return get(`/projects/${encodeURIComponent(projectId)}`, isObject);
    },

    listMergeRequests(projectId, state) {
      const query = new URLSearchParams({ state });
      return get(
        `/projects/${encodeURIComponent(projectId)}/isource/merge_requests?${query}`,
        Array.isArray,
      );
    },

    viewMergeRequest(projectId, iid) {
      return get(
        `/projects/${encodeURIComponent(projectId)}/isource/merge_requests/${encodeURIComponent(iid)}`,
        isObject,
      );
    },

    listMergeRequestCommits(projectId, iid) {
      return get(
        `/projects/${encodeURIComponent(projectId)}/merge_requests/${encodeURIComponent(iid)}/commits`,
        Array.isArray,
      );
    },

    createMergeRequestComment(projectId, iid, body, severity) {
      return requestJson({
        ...common,
        url: apiUrl(
          codehub.endpoint,
          `/projects/${encodeURIComponent(projectId)}/merge_requests/${encodeURIComponent(iid)}/discussions`,
        ),
        method: 'POST',
        headers: { ...codehubHeaders(), 'Content-Type': 'application/json' },
        body: { body, severity },
        validate: isObject,
        isCommentWrite: true,
      });
    },
  };

  function get(path, validate) {
    return requestJson({
      ...common,
      url: apiUrl(codehub.endpoint, path),
      method: 'GET',
      headers: codehubHeaders(),
      validate,
    });
  }

  function codehubHeaders() {
    if (!codehub || !credential) throw new CliError('AUTH_ERROR');
    const headers = { 'X-Apig-AppCode': codehub.appCode };
    if (credential.authentication_type === AUTH_TYPES.PRIVATE_TOKEN) {
      headers['private-token'] = credential.token;
    } else if (credential.authentication_type === AUTH_TYPES.DEVUC) {
      headers['X-Auth-token'] = credential.token;
    } else {
      throw new CliError('AUTH_ERROR');
    }
    return headers;
  }
}

export function apiUrl(baseUrl, path) {
  return `${baseUrl.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
