import assert from 'node:assert/strict';
import test from 'node:test';
import { createCodehubAdapter } from '../src/codehub-adapter.js';
import { createDevucClient } from '../src/devuc-client.js';
import { requestJson, stripSensitiveHeaders } from '../src/http.js';
import { devucCredential, privateCredential } from '../src/credentials.js';
import {
  commentApiFixture,
  commitApiFixture,
  mergeRequestApiFixture,
  repoApiFixture,
} from '../test-support/fixtures.js';
import { jsonResponse } from '../test-support/helpers.js';

const codehub = {
  endpoint: 'https://codehub.test/api/v4',
  appCode: 'code-app',
  origin: 'https://codehub.test',
};
const devuc = {
  endpoint: 'https://devuc.test/v2/w3tokens',
  appCode: 'devuc-app',
  origin: 'https://devuc.test',
};

test('六组 CodeHub adapter 操作使用准确 method、URL、query、Header 与 body', async () => {
  const calls = [];
  const responses = [
    [repoApiFixture],
    repoApiFixture,
    [mergeRequestApiFixture],
    mergeRequestApiFixture,
    [commitApiFixture],
    commentApiFixture,
  ];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options });
    return jsonResponse(200, responses.shift());
  };
  const adapter = createCodehubAdapter({
    codehub,
    credential: privateCredential('private-secret'),
    timeoutMs: 1_000,
    fetchImpl,
  });

  await adapter.listProjects('12');
  await adapter.viewProject('34');
  await adapter.listMergeRequests('34', 'opened');
  await adapter.viewMergeRequest('34', '7');
  await adapter.listMergeRequestCommits('34', '7');
  await adapter.createMergeRequestComment('34', '7', '原样正文\n$()', 'major');

  assert.deepEqual(
    calls.map((call) => call.url),
    [
      'https://codehub.test/api/v4/groups/12/projects',
      'https://codehub.test/api/v4/projects/34',
      'https://codehub.test/api/v4/projects/34/isource/merge_requests?state=opened',
      'https://codehub.test/api/v4/projects/34/isource/merge_requests/7',
      'https://codehub.test/api/v4/projects/34/merge_requests/7/commits',
      'https://codehub.test/api/v4/projects/34/merge_requests/7/discussions',
    ],
  );
  for (const call of calls.slice(0, -1)) {
    assert.equal(call.options.method, 'GET');
    assert.deepEqual(call.options.headers, {
      'X-Apig-AppCode': 'code-app',
      'private-token': 'private-secret',
    });
    assert.equal(call.options.body, undefined);
  }
  const comment = calls.at(-1);
  assert.equal(comment.options.method, 'POST');
  assert.deepEqual(comment.options.headers, {
    'X-Apig-AppCode': 'code-app',
    'private-token': 'private-secret',
    'Content-Type': 'application/json',
  });
  assert.equal(comment.options.body, JSON.stringify({ body: '原样正文\n$()', severity: 'major' }));
});

test('DevUC client 与 CodeHub adapter 鉴权准确且绝不同时发送 private-token', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options });
    return calls.length === 1
      ? jsonResponse(200, { status: 'ok', result: { newToken: 'new-token' } })
      : jsonResponse(200, []);
  };
  const credential = devucCredential({
    account: 'Agent1',
    password: 'password',
    token: 'old-token',
    issuedAtMs: 0,
  });
  const devucClient = createDevucClient({ devuc, timeoutMs: 1_000, fetchImpl });
  assert.equal(await devucClient.login('Agent1', 'password'), 'new-token');

  const codehubAdapter = createCodehubAdapter({ codehub, credential, timeoutMs: 1_000, fetchImpl });
  await codehubAdapter.listProjects('1');
  assert.deepEqual(calls[0].options.headers, {
    'X-Apig-AppCode': 'devuc-app',
    'Content-Type': 'application/json',
  });
  assert.deepEqual(JSON.parse(calls[0].options.body), { account: 'Agent1', password: 'password' });
  assert.deepEqual(calls[1].options.headers, {
    'X-Apig-AppCode': 'code-app',
    'X-Auth-token': 'old-token',
  });
  assert.equal('private-token' in calls[1].options.headers, false);
});

test('DevUC 缺少 newToken、HTTP 或网络失败统一返回 AUTH_ERROR', async () => {
  for (const fetchImpl of [
    async () => jsonResponse(200, { status: 'ok', result: {} }),
    async () => jsonResponse(403, { error: true }),
    async () => {
      throw Object.assign(new Error('offline'), { code: 'ENOTFOUND' });
    },
  ]) {
    const client = createDevucClient({ devuc, timeoutMs: 1_000, fetchImpl });
    await assert.rejects(client.login('Agent1', 'password'), { code: 'AUTH_ERROR' });
  }
});

test('HTTP 请求在网络失败和 5xx 时都不重试', async () => {
  let calls = 0;
  await assert.rejects(
    requestJson({
      url: 'https://code.test/value',
      timeoutMs: 100,
      fetchImpl: async () => {
        calls += 1;
        throw Object.assign(new Error('offline'), { code: 'ENOTFOUND' });
      },
    }),
    { code: 'NETWORK_ERROR' },
  );
  assert.equal(calls, 1);

  calls = 0;
  await assert.rejects(
    requestJson({
      url: 'https://code.test/value',
      timeoutMs: 100,
      fetchImpl: async () => {
        calls += 1;
        return jsonResponse(503, { error: true });
      },
    }),
    { code: 'HTTP_ERROR', httpStatus: 503 },
  );
  assert.equal(calls, 1);
});

test('GET 跨 origin 重定向移除所有敏感 Header，同 origin 保留', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), headers: options.headers });
    if (calls.length === 1)
      return new Response('', { status: 302, headers: { location: '/next' } });
    if (calls.length === 2)
      return new Response('', { status: 302, headers: { location: 'https://other.test/final' } });
    return jsonResponse(200, { ok: true });
  };
  await requestJson({
    url: 'https://code.test/start',
    timeoutMs: 1_000,
    fetchImpl,
    headers: {
      'X-Apig-AppCode': 'app',
      'private-token': 'token',
      Authorization: 'secret',
      Cookie: 'session=secret',
      Accept: 'application/json',
    },
  });
  assert.equal(calls[1].headers['private-token'], 'token');
  assert.deepEqual(calls[2].headers, { Accept: 'application/json' });
});

test('POST 不跟随重定向且最多发出一次', async () => {
  let calls = 0;
  await assert.rejects(
    requestJson({
      url: 'https://code.test/write',
      method: 'POST',
      body: { value: true },
      timeoutMs: 1_000,
      fetchImpl: async () => {
        calls += 1;
        return new Response('', { status: 307, headers: { location: 'https://other.test/write' } });
      },
      isCommentWrite: true,
    }),
    { code: 'HTTP_ERROR', httpStatus: 307 },
  );
  assert.equal(calls, 1);
});

test('超过五次 GET 重定向停止并返回 HTTP_ERROR', async () => {
  let calls = 0;
  await assert.rejects(
    requestJson({
      url: 'https://code.test/start',
      timeoutMs: 1_000,
      fetchImpl: async () => {
        calls += 1;
        return new Response('', { status: 302, headers: { location: `/next-${calls}` } });
      },
    }),
    { code: 'HTTP_ERROR', httpStatus: 302 },
  );
  assert.equal(calls, 6);
});

test('401、其他 HTTP、无效 JSON 和错误顶层结构准确分类', async () => {
  const cases = [
    [async () => jsonResponse(401, {}), 'AUTH_ERROR', 401],
    [async () => jsonResponse(403, {}), 'HTTP_ERROR', 403],
    [async () => new Response('not-json', { status: 200 }), 'HTTP_ERROR', 200],
    [async () => jsonResponse(200, {}), 'HTTP_ERROR', 200],
  ];
  for (const [fetchImpl, code, status] of cases) {
    await assert.rejects(
      requestJson({
        url: 'https://code.test/value',
        timeoutMs: 1_000,
        fetchImpl,
        validate: Array.isArray,
      }),
      { code, httpStatus: status },
    );
  }
});

test('评论发送前确定失败为 NETWORK_ERROR，其他网络/超时为 WRITE_RESULT_UNKNOWN', async () => {
  for (const code of ['ENOTFOUND', 'ECONNREFUSED', 'ERR_TLS_CERT_ALTNAME_INVALID']) {
    await assert.rejects(
      requestJson({
        url: 'https://code.test/write',
        method: 'POST',
        timeoutMs: 100,
        isCommentWrite: true,
        fetchImpl: async () => {
          throw Object.assign(new Error(code), { code });
        },
      }),
      { code: 'NETWORK_ERROR' },
    );
  }

  await assert.rejects(
    requestJson({
      url: 'https://code.test/write',
      method: 'POST',
      timeoutMs: 100,
      isCommentWrite: true,
      fetchImpl: async () => {
        throw Object.assign(new Error('reset'), { code: 'ECONNRESET' });
      },
    }),
    { code: 'WRITE_RESULT_UNKNOWN' },
  );

  await assert.rejects(
    requestJson({
      url: 'https://code.test/write',
      method: 'POST',
      timeoutMs: 5,
      isCommentWrite: true,
      fetchImpl: async (_url, { signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => reject(Object.assign(new Error('abort'), { name: 'AbortError' })),
            { once: true },
          );
        }),
    }),
    { code: 'WRITE_RESULT_UNKNOWN' },
  );
});

test('评论响应流中断为结果未知，完整非 JSON 响应为 HTTP_ERROR', async () => {
  await assert.rejects(
    requestJson({
      url: 'https://code.test/write',
      method: 'POST',
      timeoutMs: 100,
      isCommentWrite: true,
      fetchImpl: async () => ({
        status: 200,
        ok: true,
        headers: new Headers(),
        text: async () => {
          throw new Error('socket closed');
        },
      }),
    }),
    { code: 'WRITE_RESULT_UNKNOWN' },
  );

  await assert.rejects(
    requestJson({
      url: 'https://code.test/write',
      method: 'POST',
      timeoutMs: 100,
      isCommentWrite: true,
      fetchImpl: async () => new Response('bad json', { status: 200 }),
    }),
    { code: 'HTTP_ERROR', httpStatus: 200 },
  );
});

test('调用方取消请求返回 CANCELLED', async () => {
  const controller = new AbortController();
  const promise = requestJson({
    url: 'https://code.test/value',
    timeoutMs: 1_000,
    signal: controller.signal,
    fetchImpl: async (_url, { signal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener(
          'abort',
          () => reject(Object.assign(new Error('abort'), { name: 'AbortError' })),
          { once: true },
        );
      }),
  });
  controller.abort();
  await assert.rejects(promise, { code: 'CANCELLED' });
});

test('stripSensitiveHeaders 大小写不敏感且保留普通 Header', () => {
  assert.deepEqual(
    stripSensitiveHeaders({
      'PRIVATE-TOKEN': 'a',
      'x-auth-token': 'b',
      'X-APIG-APPCODE': 'c',
      authorization: 'd',
      COOKIE: 'e',
      Accept: 'application/json',
    }),
    { Accept: 'application/json' },
  );
});
