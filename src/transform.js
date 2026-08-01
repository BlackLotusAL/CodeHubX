export function projectRepoList(projects) {
  return projects.map((project) => projectRepoSummary(project));
}

export function projectRepoView(project, repoId = null) {
  return {
    ...projectRepoSummary(project, repoId),
    default_branch: textOrNull(project?.default_branch),
    web_url: textOrNull(project?.web_url),
  };
}

export function projectMergeRequestList(mergeRequests, repoId = null) {
  return mergeRequests.map((mergeRequest) =>
    projectMergeRequestSummary(mergeRequest, repoId),
  );
}

export function projectMergeRequestView(mergeRequest, repoId = null) {
  return {
    ...projectMergeRequestSummary(mergeRequest, repoId),
    description: textOrNull(mergeRequest?.description),
    labels: labelsOrNull(mergeRequest?.labels),
    created_at: textOrNull(mergeRequest?.created_at),
    changes: {
      files: numberOrNull(mergeRequest?.changes_count),
      additions: numberOrNull(mergeRequest?.added_lines),
      deletions: numberOrNull(mergeRequest?.removed_lines),
    },
  };
}

export function projectCommitList(commits) {
  return commits.map((commit) => ({
    sha: idOrNull(commit?.id),
    title: textOrNull(commit?.title),
    message: textOrNull(commit?.message),
    author: personOrNull(commit?.author_name, commit?.author_email),
    committer: personOrNull(commit?.committer_name, commit?.committer_email),
    authored_at: textOrNull(commit?.authored_date),
    committed_at: textOrNull(commit?.committed_date),
    parent_shas: stringArrayOrNull(commit?.parent_ids),
  }));
}

export function projectCommentResult(response, { repoId, mrIid, severity }) {
  return {
    comment_id: idOrNull(response?.id),
    repo_id: idOrNull(response?.project_id ?? repoId),
    mr_iid: idOrNull(mrIid),
    severity: textOrNull(response?.severity ?? severity),
    resolved: booleanOrNull(response?.resolved),
    web_url: textOrNull(response?.web_url),
  };
}

function projectRepoSummary(project, repoId = null) {
  return {
    repo_id: idOrNull(project?.id ?? repoId),
    full_name: textOrNull(
      project?.path_with_namespace ??
        project?.name_with_namespace ??
        project?.name,
    ),
    clone_urls: {
      ssh: textOrNull(project?.ssh_url_to_repo),
      https: textOrNull(project?.http_url_to_repo),
    },
    archived: booleanOrNull(project?.archived),
    updated_at: textOrNull(project?.updated_at ?? project?.last_activity_at),
  };
}

function projectMergeRequestSummary(mergeRequest, repoId = null) {
  return {
    repo_id: idOrNull(mergeRequest?.project_id ?? repoId),
    mr_id: idOrNull(mergeRequest?.id),
    iid: idOrNull(mergeRequest?.iid),
    title: textOrNull(mergeRequest?.title),
    state: textOrNull(mergeRequest?.state),
    is_draft: booleanOrNull(
      mergeRequest?.is_draft ?? mergeRequest?.work_in_progress,
    ),
    author: userOrNull(mergeRequest?.author),
    source_branch: textOrNull(mergeRequest?.source_branch),
    target_branch: textOrNull(mergeRequest?.target_branch),
    updated_at: textOrNull(
      mergeRequest?.updated_at ?? mergeRequest?.last_activity_at,
    ),
    web_url: textOrNull(mergeRequest?.web_url),
  };
}

function userOrNull(user) {
  if (user === null || typeof user !== 'object' || Array.isArray(user)) {
    return null;
  }

  return {
    id: idOrNull(user.id),
    username: textOrNull(user.username),
    name: textOrNull(user.name),
    type: textOrNull(user.type),
  };
}

function personOrNull(name, email) {
  const projectedName = textOrNull(name);
  const projectedEmail = textOrNull(email);
  if (projectedName === null && projectedEmail === null) {
    return null;
  }

  return {
    name: projectedName,
    email: projectedEmail,
  };
}

function labelsOrNull(labels) {
  if (!Array.isArray(labels)) {
    return null;
  }

  return labels
    .map((label) => {
      if (typeof label === 'string') {
        return label;
      }
      if (label !== null && typeof label === 'object') {
        return textOrNull(label.name ?? label.title);
      }
      return null;
    })
    .filter((label) => label !== null);
}

function stringArrayOrNull(values) {
  if (!Array.isArray(values)) {
    return null;
  }

  return values.map(idOrNull).filter((value) => value !== null);
}

function idOrNull(value) {
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }
  if (
    (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) ||
    (typeof value === 'bigint' && value >= 0n)
  ) {
    return String(value);
  }
  return null;
}

function textOrNull(value) {
  return typeof value === 'string' ? value : null;
}

function booleanOrNull(value) {
  return typeof value === 'boolean' ? value : null;
}

function numberOrNull(value) {
  if (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0
  ) {
    return value;
  }
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }
  return null;
}

export function sanitiseForOutput(value, sensitiveValues = []) {
  const secrets = [...sensitiveValues].filter(
    (secret) => typeof secret === 'string' && secret.length > 0,
  );
  return sanitise(value, secrets);
}

function sanitise(value, secrets) {
  if (Array.isArray(value)) {
    return value.map((child) => sanitise(child, secrets));
  }

  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        sanitise(child, secrets),
      ]),
    );
  }

  if (typeof value !== 'string') {
    return value;
  }

  let output = stripUrlCredentials(value);
  for (const secret of secrets) {
    output = output.replaceAll(secret, '[REDACTED]');
  }
  return output;
}

function stripUrlCredentials(value) {
  if (!/^[A-Za-z][A-Za-z\d+.-]*:\/\//.test(value)) {
    return value;
  }

  try {
    const url = new URL(value);
    if (!url.username && !url.password) {
      return value;
    }
    url.username = '';
    url.password = '';
    return url.toString();
  } catch {
    return value;
  }
}
