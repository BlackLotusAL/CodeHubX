import { AUTH_TYPES } from './constants.js';
import { CliError } from './errors.js';
import { requestJson } from './http.js';

export function createCodehubAdapter({
  codehub,
  credential,
  timeoutMs,
  fetchImpl,
  signal,
} = {}) {
  const common = { timeoutMs, fetchImpl, signal };
  const authenticationHeaders = createAuthenticationHeaders();

  return Object.freeze({
    listProjects,
    viewProject,
    listMergeRequests,
    viewMergeRequest,
    listMergeRequestCommits,
    createMergeRequestComment,
  });

  function listProjects(groupId) {
    return get(`/groups/${encodeURIComponent(groupId)}/projects`, Array.isArray);
  }

  function viewProject(projectId) {
    return get(`/projects/${encodeURIComponent(projectId)}`, isObject);
  }

  function listMergeRequests(projectId, state) {
    const query = new URLSearchParams({ state });
    return get(
      `/projects/${encodeURIComponent(projectId)}/isource/merge_requests?${query}`,
      Array.isArray,
    );
  }

  function viewMergeRequest(projectId, iid) {
    return get(
      `/projects/${encodeURIComponent(projectId)}/isource/merge_requests/${encodeURIComponent(iid)}`,
      isObject,
    );
  }

  function listMergeRequestCommits(projectId, iid) {
    return get(
      `/projects/${encodeURIComponent(projectId)}/merge_requests/${encodeURIComponent(iid)}/commits`,
      Array.isArray,
    );
  }

  function createMergeRequestComment(projectId, iid, body, severity) {
    return requestJson({
      ...common,
      url: apiUrl(
        codehub.endpoint,
        `/projects/${encodeURIComponent(projectId)}/merge_requests/${encodeURIComponent(iid)}/discussions`,
      ),
      method: 'POST',
      headers: { ...authenticationHeaders, 'Content-Type': 'application/json' },
      body: { body, severity },
      validate: isObject,
      isCommentWrite: true,
    });
  }

  function get(path, validate) {
    return requestJson({
      ...common,
      url: apiUrl(codehub.endpoint, path),
      method: 'GET',
      headers: authenticationHeaders,
      validate,
    });
  }

  function createAuthenticationHeaders() {
    if (!codehub || !credential) throw new CliError('AUTH_ERROR');
    const headers = { 'X-Apig-AppCode': codehub.appCode };
    if (credential.authentication_type === AUTH_TYPES.PRIVATE_TOKEN) {
      headers['private-token'] = credential.token;
    } else if (credential.authentication_type === AUTH_TYPES.DEVUC) {
      headers['X-Auth-token'] = credential.token;
    } else {
      throw new CliError('AUTH_ERROR');
    }
    return Object.freeze(headers);
  }
}

function apiUrl(baseUrl, path) {
  return `${baseUrl.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
