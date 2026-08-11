export const repoApiFixture = {
  id: 9001,
  name: 'agent-tools',
  name_with_namespace: 'Platform / Agent Tools',
  path_with_namespace: 'platform/agent-tools',
  archived: false,
  ssh_url_to_repo: 'git@codehub.test:platform/agent-tools.git',
  http_url_to_repo: 'https://codehub.test/platform/agent-tools.git',
  updated_at: '2026-07-31T08:00:00Z',
  default_branch: 'main',
  web_url: 'https://codehub.test/platform/agent-tools',
  permissions: { project_access: { access_level: 50 } },
  unknown_server_field: 'must-not-be-output',
};

export const mergeRequestApiFixture = {
  id: 701,
  iid: 17,
  project_id: 9001,
  title: '修复终端中的中文输出 🚀',
  description: '让输出在 Windows PowerShell 和 Linux 中保持一致。',
  state: 'opened',
  work_in_progress: false,
  target_branch: 'main',
  source_branch: 'fix/terminal-output',
  author: {
    id: 88,
    username: 'lin',
    name: '林开发者',
    type: 'user',
    email: 'private@example.test',
  },
  labels: ['cli', { name: 'review-ready' }],
  changes_count: '12',
  added_lines: 83,
  removed_lines: 21,
  created_at: '2026-07-30T03:00:00+08:00',
  updated_at: '2026-07-31T08:30:00Z',
  web_url: 'https://codehub.test/platform/agent-tools/-/merge_requests/17',
  assignee: { username: 'not-output' },
};

export const commitApiFixture = {
  id: '0123456789abcdef0123456789abcdef01234567',
  title: 'fix: align terminal output',
  message: 'fix: align terminal output\n\nHandle 中文 and Emoji 🚀 safely.',
  author_name: 'Lin Developer',
  author_email: 'lin@example.test',
  committer_name: 'CI Bot',
  committer_email: 'ci@example.test',
  authored_date: '2026-07-31T15:00:00+08:00',
  committed_date: '2026-07-31T07:05:00Z',
  parent_ids: ['fedcba9876543210fedcba9876543210fedcba98'],
  stats: { additions: 83, deletions: 21 },
};

export const commentApiFixture = {
  id: 'discussion-1',
  project_id: 9001,
  severity: 'major',
  resolved: false,
  web_url: 'https://codehub.test/project/mr/17#note_1',
  notes: [{ body: 'must-not-be-output' }],
};
