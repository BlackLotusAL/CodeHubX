import assert from 'node:assert/strict';
import test from 'node:test';
import {
  commentApiFixture,
  commitApiFixture,
  mergeRequestApiFixture,
  repoApiFixture,
} from '../test-support/fixtures.js';
import {
  projectCommentResult,
  projectCommitList,
  projectMergeRequestList,
  projectMergeRequestView,
  projectRepoList,
  projectRepoView,
  sanitiseForOutput,
} from '../src/transform.js';

test('Project 输出只保留代码检视所需字段并统一命名', () => {
  assert.deepEqual(projectRepoList([repoApiFixture]), [
    {
      repo_id: '9001',
      full_name: 'platform/agent-tools',
      clone_urls: {
        ssh: 'git@codehub.test:platform/agent-tools.git',
        https: 'https://codehub.test/platform/agent-tools.git',
      },
      archived: false,
      updated_at: '2026-07-31T08:00:00Z',
    },
  ]);

  assert.deepEqual(projectRepoView(repoApiFixture), {
    repo_id: '9001',
    full_name: 'platform/agent-tools',
    clone_urls: {
      ssh: 'git@codehub.test:platform/agent-tools.git',
      https: 'https://codehub.test/platform/agent-tools.git',
    },
    archived: false,
    updated_at: '2026-07-31T08:00:00Z',
    default_branch: 'main',
    web_url: 'https://codehub.test/platform/agent-tools',
  });
});

test('MR 列表与详情排除 reviewer/assignee 并保留检视上下文', () => {
  const [summary] = projectMergeRequestList([mergeRequestApiFixture]);
  assert.deepEqual(summary, {
    repo_id: '9001',
    mr_id: '701',
    iid: '17',
    title: '修复终端中的中文输出 🚀',
    state: 'opened',
    is_draft: false,
    author: {
      id: '88',
      username: 'lin',
      name: '林开发者',
      type: 'user',
    },
    source_branch: 'fix/terminal-output',
    target_branch: 'main',
    updated_at: '2026-07-31T08:30:00Z',
    web_url:
      'https://codehub.test/platform/agent-tools/-/merge_requests/17',
  });

  assert.deepEqual(projectMergeRequestView(mergeRequestApiFixture), {
    ...summary,
    description: '让输出在 Windows PowerShell 和 Linux 中保持一致。',
    labels: ['cli', 'review-ready'],
    created_at: '2026-07-30T03:00:00+08:00',
    changes: {
      files: 12,
      additions: 83,
      deletions: 21,
    },
  });
});

test('Commit 使用完整 SHA、作者/提交者和父 SHA，缺失字段固定为 null', () => {
  assert.deepEqual(projectCommitList([commitApiFixture]), [
    {
      sha: '0123456789abcdef0123456789abcdef01234567',
      title: 'fix: align terminal output',
      message:
        'fix: align terminal output\n\nHandle 中文 and Emoji 🚀 safely.',
      author: { name: 'Lin Developer', email: 'lin@example.test' },
      committer: { name: 'CI Bot', email: 'ci@example.test' },
      authored_at: '2026-07-31T15:00:00+08:00',
      committed_at: '2026-07-31T07:05:00Z',
      parent_shas: ['fedcba9876543210fedcba9876543210fedcba98'],
    },
  ]);

  assert.deepEqual(projectCommitList([{ id: 'abc', title: 'title' }]), [
    {
      sha: 'abc',
      title: 'title',
      message: null,
      author: null,
      committer: null,
      authored_at: null,
      committed_at: null,
      parent_shas: null,
    },
  ]);
});

test('评论结果使用固定白名单并从请求上下文补足目标', () => {
  assert.deepEqual(
    projectCommentResult(commentApiFixture, {
      repoId: '9001',
      mrIid: '17',
      severity: 'major',
    }),
    {
      comment_id: 'discussion-1',
      repo_id: '9001',
      mr_iid: '17',
      severity: 'major',
      resolved: false,
      web_url:
        'https://codehub.test/platform/agent-tools/-/merge_requests/17#note_1',
    },
  );
});

test('服务端缺失规范字段时保持固定结构并使用 null', () => {
  assert.equal(projectRepoList([{}])[0].repo_id, null);

  assert.deepEqual(projectRepoView({}, '42'), {
    repo_id: '42',
    full_name: null,
    clone_urls: { ssh: null, https: null },
    archived: null,
    updated_at: null,
    default_branch: null,
    web_url: null,
  });

  assert.deepEqual(projectMergeRequestView({}, '42'), {
    repo_id: '42',
    mr_id: null,
    iid: null,
    title: null,
    state: null,
    is_draft: null,
    author: null,
    source_branch: null,
    target_branch: null,
    updated_at: null,
    web_url: null,
    description: null,
    labels: null,
    created_at: null,
    changes: { files: null, additions: null, deletions: null },
  });
});

test('字段回退规则稳定且不会伪造提交者或非法变更规模', () => {
  const [repository] = projectRepoList([
    {
      id: 1,
      name_with_namespace: 'Platform / Fallback',
      last_activity_at: '2026-08-01T00:00:00Z',
    },
  ]);
  assert.equal(repository.full_name, 'Platform / Fallback');
  assert.equal(repository.updated_at, '2026-08-01T00:00:00Z');

  const mergeRequest = projectMergeRequestView(
    {
      work_in_progress: true,
      last_activity_at: '2026-08-01T01:00:00Z',
      changes_count: '1000+',
      added_lines: -1,
    },
    '2',
  );
  assert.equal(mergeRequest.is_draft, true);
  assert.equal(mergeRequest.updated_at, '2026-08-01T01:00:00Z');
  assert.deepEqual(mergeRequest.changes, {
    files: null,
    additions: null,
    deletions: null,
  });

  const [commit] = projectCommitList([
    { author_name: 'Only Author', author_email: 'author@example.test' },
  ]);
  assert.deepEqual(commit.author, {
    name: 'Only Author',
    email: 'author@example.test',
  });
  assert.equal(commit.committer, null);
});

test('输出会移除 URL 内嵌凭据并脱敏已知 secret', () => {
  const result = sanitiseForOutput(
    {
      clone_urls: {
        https: 'https://user:password@example.test/group/repo.git',
      },
      title: 'prefix token-value suffix',
    },
    ['token-value'],
  );

  assert.deepEqual(result, {
    clone_urls: { https: 'https://example.test/group/repo.git' },
    title: 'prefix [REDACTED] suffix',
  });
});
