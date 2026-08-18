import assert from 'node:assert/strict';
import test from 'node:test';
import { createCodehubOperations } from '../src/codehub-operations.js';
import {
  commentApiFixture,
  commitApiFixture,
  mergeRequestApiFixture,
  repoApiFixture,
} from '../test-support/fixtures.js';

test('项目操作将 adapter 调用与稳定项目结果绑定', async () => {
  const calls = [];
  const operations = createCodehubOperations({
    async listProjects(groupId) {
      calls.push({ method: 'listProjects', args: [groupId] });
      return [repoApiFixture];
    },
    async viewProject(projectId) {
      calls.push({ method: 'viewProject', args: [projectId] });
      return {};
    },
  });

  assert.deepEqual(await operations.projects.list('8'), [{
    repo_id: '9001',
    full_name: 'platform/agent-tools',
    clone_urls: {
      ssh: 'git@codehub.test:platform/agent-tools.git',
      https: 'https://codehub.test/platform/agent-tools.git',
    },
    archived: false,
    updated_at: '2026-07-31T08:00:00Z',
  }]);
  assert.deepEqual(await operations.projects.view('123'), {
    repo_id: '123',
    full_name: null,
    clone_urls: { ssh: null, https: null },
    archived: null,
    updated_at: null,
    default_branch: null,
    web_url: null,
  });
  assert.deepEqual(calls, [
    { method: 'listProjects', args: ['8'] },
    { method: 'viewProject', args: ['123'] },
  ]);
});

test('合并请求操作将 adapter 调用与稳定 MR、Commit 和 Comment 结果绑定', async () => {
  const calls = [];
  const operations = createCodehubOperations({
    async listMergeRequests(...args) {
      calls.push({ method: 'listMergeRequests', args });
      return [mergeRequestApiFixture];
    },
    async viewMergeRequest(...args) {
      calls.push({ method: 'viewMergeRequest', args });
      return mergeRequestApiFixture;
    },
    async listMergeRequestCommits(...args) {
      calls.push({ method: 'listMergeRequestCommits', args });
      return [commitApiFixture];
    },
    async createMergeRequestComment(...args) {
      calls.push({ method: 'createMergeRequestComment', args });
      return commentApiFixture;
    },
  });

  const list = await operations.mergeRequests.list({ projectId: '9001', state: 'opened' });
  assert.equal(list[0].repo_id, '9001');
  assert.equal(list[0].mr_id, '701');
  assert.equal(list[0].iid, '17');
  assert.deepEqual(list[0].author, {
    id: '88',
    username: 'lin',
    name: '林开发者',
    type: 'user',
  });
  assert.equal('email' in list[0].author, false);
  assert.equal('assignee' in list[0], false);

  const detail = await operations.mergeRequests.view({ projectId: '9001', iid: '17' });
  assert.deepEqual(detail.labels, ['cli', 'review-ready']);
  assert.deepEqual(detail.changes, { files: 12, additions: 83, deletions: 21 });
  assert.equal(detail.description, mergeRequestApiFixture.description);

  const commits = await operations.mergeRequests.commits({ projectId: '9001', iid: '17' });
  assert.equal(commits[0].sha, commitApiFixture.id);
  assert.deepEqual(commits[0].author, { name: 'Lin Developer', email: 'lin@example.test' });
  assert.deepEqual(commits[0].committer, { name: 'CI Bot', email: 'ci@example.test' });
  assert.deepEqual(commits[0].parent_shas, commitApiFixture.parent_ids);
  assert.equal('stats' in commits[0], false);

  const comment = await operations.mergeRequests.createComment({
    projectId: '9001',
    iid: '17',
    body: '保持原样\n$()',
    severity: 'major',
  });
  assert.deepEqual(comment, {
    comment_id: 'discussion-1',
    repo_id: '9001',
    mr_iid: '17',
    severity: 'major',
    resolved: false,
    web_url: commentApiFixture.web_url,
  });
  assert.equal('notes' in comment, false);

  assert.deepEqual(calls, [
    { method: 'listMergeRequests', args: ['9001', 'opened'] },
    { method: 'viewMergeRequest', args: ['9001', '17'] },
    { method: 'listMergeRequestCommits', args: ['9001', '17'] },
    {
      method: 'createMergeRequestComment',
      args: ['9001', '17', '保持原样\n$()', 'major'],
    },
  ]);
});

test('操作 interface 保持 ID、null 和字段回退规则', async () => {
  const operations = createCodehubOperations({
    async listProjects() {
      return [
        {
          id: null,
          name_with_namespace: 'Name',
          archived: 'false',
          last_activity_at: 'time',
        },
        { id: 42, name: 'Number' },
        { id: 42n, path_with_namespace: 'BigInt' },
        { id: Number.MAX_SAFE_INTEGER + 1 },
        { id: -1 },
        { id: '0001' },
      ];
    },
    async viewMergeRequest() {
      return {
        labels: [null, 3, { title: 'title' }, {}],
        changes_count: '999999999999999999999999',
        added_lines: -1,
        removed_lines: '2',
        author: [],
        work_in_progress: true,
        last_activity_at: 'time',
      };
    },
    async listMergeRequestCommits() {
      return [{}];
    },
    async createMergeRequestComment() {
      return {};
    },
  });

  const projects = await operations.projects.list('8');
  assert.deepEqual(projects.map((project) => project.repo_id), [
    null, '42', '42', null, null, '0001',
  ]);
  assert.equal(projects[0].full_name, 'Name');
  assert.equal(projects[0].archived, null);
  assert.equal(projects[0].updated_at, 'time');
  assert.equal(projects[1].full_name, 'Number');

  const mr = await operations.mergeRequests.view({ projectId: '1', iid: '2' });
  assert.equal(mr.repo_id, '1');
  assert.equal(mr.iid, '2');
  assert.equal(mr.is_draft, true);
  assert.equal(mr.updated_at, 'time');
  assert.deepEqual(mr.labels, ['title']);
  assert.deepEqual(mr.changes, { files: null, additions: null, deletions: 2 });
  assert.equal(mr.author, null);

  const commit = (await operations.mergeRequests.commits({ projectId: '1', iid: '2' }))[0];
  assert.equal(commit.author, null);
  assert.equal(commit.parent_shas, null);

  assert.deepEqual(await operations.mergeRequests.createComment({
    projectId: '1', iid: '2', body: 'x', severity: 'suggestion',
  }), {
    comment_id: null,
    repo_id: '1',
    mr_iid: '2',
    severity: 'suggestion',
    resolved: null,
    web_url: null,
  });
});

test('项目操作不改写服务端字符串和 SSH URL 用户名', async () => {
  const operations = createCodehubOperations({
    async viewProject() {
      return {
        id: 9001,
        path_with_namespace: 'prefix-private-secret-suffix',
        web_url: 'https://user:password@codehub.test/project',
        ssh_url_to_repo: 'ssh://git@codehub.test/platform/agent-tools.git',
      };
    },
  });

  const result = await operations.projects.view('9001');
  assert.equal(result.full_name, 'prefix-private-secret-suffix');
  assert.equal(result.web_url, 'https://user:password@codehub.test/project');
  assert.equal(result.clone_urls.ssh, 'ssh://git@codehub.test/platform/agent-tools.git');
});
