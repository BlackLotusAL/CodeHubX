import assert from 'node:assert/strict';
import test from 'node:test';
import { createApiClient } from '../src/api.js';
import { runCli } from '../src/cli.js';
import { MemoryCredentialStore, privateCredential } from '../src/credentials.js';
import { CliError, errorResult, humanErrorMessage, toCliError } from '../src/errors.js';
import { requestJson } from '../src/http.js';
import { renderHuman } from '../src/output.js';
import { createInteractivePrompter } from '../src/prompts.js';
import {
  projectCommitList,
  projectMergeRequestView,
  projectRepoList,
} from '../src/transform.js';
import { captureIo, configStore, jsonResponse, parseSingleJson } from '../test-support/helpers.js';

const humanIo = { columns: 50, env: {}, stdoutIsTTY: false };

test('所有 human 命令分支、空列表和 null 值都有稳定展示', () => {
  assert.match(renderHuman('config.init', { created: true, config_path: '/config.json' }, { io: humanIo }), /已创建/);
  assert.match(renderHuman('auth.login', {
    configured: true,
    authentication_type: 'private_token',
    api_host: 'https://code.test',
  }, { io: humanIo }), /Private Token/);
  assert.match(renderHuman('auth.status', {
    configured: true,
    authentication_type: 'devuc',
    api_host: 'https://code.test',
  }, { io: humanIo }), /已登录/);
  assert.match(renderHuman('auth.logout', {
    credential_helper_cleared: true,
    api_host: 'https://code.test',
  }, { io: humanIo }), /已清除/);
  assert.equal(renderHuman('repo.list', [], { io: humanIo }), '○ 没有仓库。');
  assert.equal(renderHuman('mr.list', [], { io: humanIo }), '○ 没有 Merge Request。');
  assert.equal(renderHuman('mr.commits', [], { io: humanIo }), '○ 没有 Commit。');
  assert.match(renderHuman('unknown', { ok: true }, { io: humanIo }), /"ok":true/);

  const repo = renderHuman('repo.view', {
    repo_id: '1',
    full_name: null,
    clone_urls: { ssh: null, https: null },
    archived: null,
    updated_at: 'invalid',
    default_branch: null,
    web_url: null,
  }, { io: humanIo });
  assert.match(repo, /Project 1/);
  assert.match(repo, /状态未知/);

  const comment = renderHuman('mr.comment.create', {
    comment_id: null,
    repo_id: '1',
    mr_iid: '2',
    severity: 'minor',
    resolved: true,
    web_url: null,
  }, { io: humanIo });
  assert.match(comment, /已解决\s+是/);
});

test('human MR 状态颜色覆盖 merged、closed 与普通状态', () => {
  const base = {
    repo_id: '1', mr_id: '2', iid: '3', title: 'title', is_draft: null,
    author: { id: null, username: 'user', name: null, type: null },
    source_branch: null, target_branch: null, updated_at: 'invalid', web_url: null,
  };
  for (const [state, code] of [['merged', '35'], ['closed', '31'], ['locked', null]]) {
    const output = renderHuman('mr.list', [{ ...base, state }], {
      io: { columns: 80, env: { CLICOLOR_FORCE: '1' }, stdoutIsTTY: false },
    });
    if (code) assert.match(output, new RegExp(`\\u001B\\[${code}m`));
    else assert.doesNotMatch(output, /\u001B\[(?:35|31)mlocked/);
  }
});

test('MR 详情、Commit 缺失字段和相同消息分支可读', () => {
  const mr = renderHuman('mr.view', {
    repo_id: '1', mr_id: null, iid: '2', title: null, state: null, is_draft: true,
    author: null, source_branch: null, target_branch: null, labels: null,
    created_at: null, updated_at: 'invalid', changes: null, description: null, web_url: null,
  }, { io: humanIo });
  assert.match(mr, /草稿\s+是/);
  assert.match(mr, /变更\s+-/);

  const commit = renderHuman('mr.commits', [{
    sha: null,
    title: 'same',
    message: 'same',
    author: { name: 'Author', email: null },
    committer: null,
    authored_at: null,
    committed_at: 'invalid',
    parent_shas: null,
  }], { io: humanIo });
  assert.match(commit, /作者 Author/);
  assert.match(commit, /提交者 -/);
  assert.match(commit, /父 SHA -/);
  assert.equal((commit.match(/same/g) ?? []).length, 1);
});

test('repo 列表跳过 null clone URL并处理未来与无效时间', () => {
  const output = renderHuman('repo.list', [
    {
      repo_id: '1', full_name: 'one', clone_urls: { ssh: null, https: null },
      archived: false, updated_at: 'invalid',
    },
    {
      repo_id: '2', full_name: 'two', clone_urls: { ssh: 'ssh', https: null },
      archived: false, updated_at: '2027-01-01T00:00:00Z',
    },
  ], { io: humanIo, now: Date.parse('2026-01-01T00:00:00Z') });
  assert.match(output, /one[\s\S]*更新 -/);
  assert.match(output, /two[\s\S]*更新 刚刚/);
  assert.equal((output.match(/SSH/g) ?? []).length, 1);
});

test('错误转换覆盖已有错误、Commander、Abort 和未知异常', () => {
  const existing = new CliError('CONFIG_ERROR');
  assert.equal(toCliError(existing), existing);
  assert.equal(toCliError({ code: 'commander.unknownOption' }).code, 'INVALID_ARGUMENT');
  assert.equal(toCliError(Object.assign(new Error('x'), { name: 'AbortError' })).code, 'CANCELLED');
  assert.equal(toCliError(new Error('USER_CANCELLED')).code, 'CANCELLED');
  assert.equal(toCliError(new Error('unexpected')).code, 'HTTP_ERROR');
  assert.deepEqual(errorResult(new CliError('NETWORK_ERROR')), {
    code: 'NETWORK_ERROR',
    message: 'CodeHub request failed due to a network error.',
  });
  assert.equal(humanErrorMessage(new CliError('CANCELLED')), '[CANCELLED] 操作已取消。');
});

test('HTTP 覆盖响应读取失败、validate 抛错、缺失 Location 和预取消', async () => {
  await assert.rejects(requestJson({
    url: 'https://code.test/value',
    timeoutMs: 100,
    fetchImpl: async () => ({
      status: 200, ok: true, headers: new Headers(),
      text: async () => { throw new Error('read failed'); },
    }),
  }), { code: 'HTTP_ERROR', httpStatus: 200 });

  await assert.rejects(requestJson({
    url: 'https://code.test/value',
    timeoutMs: 100,
    fetchImpl: async () => jsonResponse(200, { ok: true }),
    validate: () => { throw new Error('validator'); },
  }), { code: 'HTTP_ERROR', httpStatus: 200 });

  await assert.rejects(requestJson({
    url: 'https://code.test/value',
    timeoutMs: 100,
    fetchImpl: async () => new Response('', { status: 302 }),
  }), { code: 'HTTP_ERROR', httpStatus: 302 });

  const controller = new AbortController();
  controller.abort(new Error('cancelled'));
  await assert.rejects(requestJson({
    url: 'https://code.test/value',
    timeoutMs: 100,
    signal: controller.signal,
    fetchImpl: async (_url, { signal }) => {
      assert.equal(signal.aborted, true);
      throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    },
  }), { code: 'CANCELLED' });
});

test('评论 timeout 即使携带发送前错误码也保守标记结果未知', async () => {
  await assert.rejects(requestJson({
    url: 'https://code.test/write',
    method: 'POST',
    timeoutMs: 5,
    isCommentWrite: true,
    fetchImpl: async (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => {
        reject(Object.assign(new Error('timeout'), { code: 'ENOTFOUND' }));
      }, { once: true });
    }),
  }), { code: 'WRITE_RESULT_UNKNOWN' });
});

test('API 防御缺少配置、未知凭据类型与 DevUC 取消', async () => {
  await assert.rejects(
    createApiClient({ timeoutMs: 100 }).devucLogin('a', 'b'),
    { code: 'CONFIG_ERROR' },
  );
  const controller = new AbortController();
  const cancelled = createApiClient({
    devuc: { endpoint: 'https://devuc.test', appCode: 'x' },
    timeoutMs: 100,
    signal: controller.signal,
    fetchImpl: async (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(Object.assign(new Error('abort'), { name: 'AbortError' })), { once: true });
    }),
  });
  const cancelledRequest = cancelled.devucLogin('a', 'b');
  controller.abort();
  await assert.rejects(
    cancelledRequest,
    { code: 'CANCELLED' },
  );
  assert.throws(
    () => createApiClient({
      codehub: { endpoint: 'https://code.test', appCode: 'x' },
      credential: { authentication_type: 'unknown', token: 'x' },
      timeoutMs: 100,
    }).listProjects('1'),
    { code: 'AUTH_ERROR' },
  );
});

test('CLI 预取消、非法认证选择与 --output=human 推断分支稳定', async () => {
  const cancelled = captureIo();
  const controller = new AbortController();
  controller.abort();
  assert.equal(await runCli(['config', 'init'], {
    io: cancelled.io,
    signal: controller.signal,
  }), 130);
  assert.equal(parseSingleJson(cancelled.capture.stderr).code, 'CANCELLED');

  const invalid = captureIo();
  assert.equal(await runCli(['auth', 'login'], {
    io: invalid.io,
    configStore: configStore(),
    credentialStore: new MemoryCredentialStore(),
    prompter: { chooseAuthenticationType: async () => 'unknown' },
  }), 2);

  const human = captureIo();
  assert.equal(await runCli(['auth', 'status', '--output=human'], {
    io: human.io,
    configStore: configStore(),
    credentialStore: new MemoryCredentialStore(),
  }), 0);
  assert.match(human.capture.stdout, /未登录/);
});

test('prompt 未知错误也转换为 CANCELLED', async () => {
  const prompter = createInteractivePrompter({
    input: { isTTY: true },
    output: { isTTY: true },
    promptApi: {
      input: async () => 'Agent01',
      select: async () => { throw new Error('unexpected'); },
      password: async () => 'x',
    },
  });
  await assert.rejects(prompter.chooseAuthenticationType(), { code: 'CANCELLED' });
});

test('投影边缘类型保持 null 和回退规则', () => {
  assert.deepEqual(projectRepoList([{
    id: null,
    name_with_namespace: 'Name',
    archived: 'false',
    last_activity_at: 'time',
  }])[0], {
    repo_id: null,
    full_name: 'Name',
    clone_urls: { ssh: null, https: null },
    archived: null,
    updated_at: 'time',
  });
  const mr = projectMergeRequestView({
    labels: [null, 3, { title: 'title' }, {}],
    changes_count: '999999999999999999999999',
    added_lines: -1,
    removed_lines: '2',
    author: [],
  }, '1', '2');
  assert.deepEqual(mr.labels, ['title']);
  assert.deepEqual(mr.changes, { files: null, additions: null, deletions: 2 });
  assert.equal(mr.author, null);
  const commit = projectCommitList([{}])[0];
  assert.equal(commit.author, null);
  assert.equal(commit.parent_shas, null);
});
