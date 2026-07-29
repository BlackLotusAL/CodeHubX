import assert from 'node:assert/strict';
import test from 'node:test';
import { requestJson } from '../src/http.js';
import { jsonResponse } from '../test-support/helpers.js';

test('GET 对可重试 5xx 最多额外重试两次', async () => {
  let calls = 0;
  const delays = [];
  const retries = [];
  const result = await requestJson({
    url: 'https://codehub.test/resource',
    method: 'GET',
    headers: {},
    timeoutMs: 1_000,
    fetchImpl: async () => {
      calls += 1;
      return calls < 3
        ? jsonResponse({ message: 'unavailable' }, { status: 503 })
        : jsonResponse([{ id: 1 }]);
    },
    sleep: async (milliseconds) => {
      delays.push(milliseconds);
    },
    random: () => 0,
    onRetry: (retry) => retries.push(retry),
    validate: Array.isArray,
  });

  assert.equal(calls, 3);
  assert.deepEqual(delays, [250, 500]);
  assert.deepEqual(
    retries.map(({ attempt, reason }) => ({ attempt, reason })),
    [
      { attempt: 1, reason: 'HTTP_503' },
      { attempt: 2, reason: 'HTTP_503' },
    ],
  );
  assert.equal(result.retryCount, 2);
  assert.deepEqual(result.data, [{ id: 1 }]);
});

test('GET 优先遵循 Retry-After', async () => {
  let calls = 0;
  const delays = [];
  await requestJson({
    url: 'https://codehub.test/resource',
    method: 'GET',
    headers: {},
    timeoutMs: 1_000,
    fetchImpl: async () => {
      calls += 1;
      return calls === 1
        ? jsonResponse({}, { status: 429, headers: { 'retry-after': '2' } })
        : jsonResponse({});
    },
    sleep: async (milliseconds) => {
      delays.push(milliseconds);
    },
    validate: (value) => value !== null && typeof value === 'object',
  });

  assert.deepEqual(delays, [2_000]);
});

test('POST 网络结果未知时不重试并返回 WRITE_RESULT_UNKNOWN', async () => {
  let calls = 0;
  await assert.rejects(
    requestJson({
      url: 'https://codehub.test/write',
      method: 'POST',
      headers: {},
      body: { body: 'review' },
      timeoutMs: 1_000,
      fetchImpl: async () => {
        calls += 1;
        throw new TypeError('socket reset');
      },
      validate: () => true,
      isWrite: true,
    }),
    {
      code: 'WRITE_RESULT_UNKNOWN',
      retryable: false,
    },
  );
  assert.equal(calls, 1);
});

test('POST 503 不重试', async () => {
  let calls = 0;
  await assert.rejects(
    requestJson({
      url: 'https://codehub.test/write',
      method: 'POST',
      headers: {},
      body: {},
      timeoutMs: 1_000,
      fetchImpl: async () => {
        calls += 1;
        return jsonResponse({}, { status: 503 });
      },
      validate: () => true,
      isWrite: true,
    }),
    { code: 'SERVER_ERROR', httpStatus: 503 },
  );
  assert.equal(calls, 1);
});

test('GET 跨 host 重定向会移除认证 Header', async () => {
  const requests = [];
  const result = await requestJson({
    url: 'https://codehub.test/resource',
    method: 'GET',
    headers: {
      'private-token': 'secret',
      'X-Apig-AppCode': 'app-secret',
      Accept: 'application/json',
    },
    timeoutMs: 1_000,
    fetchImpl: async (url, init) => {
      requests.push({ url: String(url), headers: init.headers });
      return requests.length === 1
        ? new Response(null, {
            status: 302,
            headers: { location: 'https://redirect.test/resource' },
          })
        : jsonResponse({ ok: true });
    },
    validate: (value) => value.ok === true,
  });

  assert.equal(result.data.ok, true);
  assert.equal(requests.length, 2);
  assert.equal(requests[1].headers['private-token'], undefined);
  assert.equal(requests[1].headers['X-Apig-AppCode'], undefined);
  assert.equal(requests[1].headers.Accept, 'application/json');
});

test('2xx 非 JSON 响应映射为 RESPONSE_SCHEMA_ERROR', async () => {
  await assert.rejects(
    requestJson({
      url: 'https://codehub.test/resource',
      method: 'GET',
      headers: {},
      timeoutMs: 1_000,
      fetchImpl: async () => new Response('<html>ok</html>', { status: 200 }),
      validate: () => true,
    }),
    { code: 'RESPONSE_SCHEMA_ERROR' },
  );
});

test('GET 401 不重试并映射为 AUTH_FAILED', async () => {
  let calls = 0;
  await assert.rejects(
    requestJson({
      url: 'https://codehub.test/resource',
      method: 'GET',
      headers: {},
      timeoutMs: 1_000,
      fetchImpl: async () => {
        calls += 1;
        return jsonResponse({}, { status: 401 });
      },
      validate: () => true,
    }),
    { code: 'AUTH_FAILED', httpStatus: 401 },
  );
  assert.equal(calls, 1);
});

test('GET 网络错误可以重试后成功', async () => {
  let calls = 0;
  const result = await requestJson({
    url: 'https://codehub.test/resource',
    method: 'GET',
    headers: {},
    timeoutMs: 1_000,
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) {
        throw new TypeError('connection reset');
      }
      return jsonResponse({ ok: true });
    },
    sleep: async () => {},
    random: () => 0,
    validate: (value) => value.ok === true,
  });

  assert.equal(calls, 2);
  assert.equal(result.retryCount, 1);
});

test('HTTP 400、403、404 映射到稳定错误码且不重试', async () => {
  const cases = [
    [400, 'INVALID_ARGUMENT'],
    [403, 'FORBIDDEN'],
    [404, 'NOT_FOUND'],
  ];

  for (const [status, code] of cases) {
    let calls = 0;
    await assert.rejects(
      requestJson({
        url: 'https://codehub.test/resource',
        method: 'GET',
        headers: {},
        timeoutMs: 1_000,
        fetchImpl: async () => {
          calls += 1;
          return jsonResponse({}, { status });
        },
        validate: () => true,
      }),
      { code, httpStatus: status },
    );
    assert.equal(calls, 1);
  }
});
