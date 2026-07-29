import { CliError } from './errors.js';

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const SENSITIVE_HEADERS = new Set([
  'private-token',
  'x-auth-token',
  'x-apig-appcode',
  'authorization',
]);
const TLS_ERROR_CODES = new Set([
  'CERT_HAS_EXPIRED',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
]);

export async function requestJson(options) {
  const {
    url,
    method = 'GET',
    headers = {},
    body,
    timeoutMs,
    fetchImpl = globalThis.fetch,
    sleep = sleepWithSignal,
    random = Math.random,
    signal,
    validate = () => true,
    isWrite = false,
    onRetry = () => {},
  } = options;
  const maxRetries = method === 'GET' ? 2 : 0;

  for (let attempt = 0; ; attempt += 1) {
    let response;
    try {
      response = await fetchWithTimeoutAndRedirects({
        url,
        method,
        headers,
        body,
        timeoutMs,
        fetchImpl,
        signal,
      });
    } catch (error) {
      const mapped = mapFetchError(error, { isWrite, signal });
      if (
        method === 'GET' &&
        attempt < maxRetries &&
        (mapped.code === 'NETWORK_ERROR' || mapped.code === 'TIMEOUT')
      ) {
        const delay = backoffMilliseconds(attempt, random);
        onRetry({
          attempt: attempt + 1,
          delay,
          reason: mapped.code,
        });
        await sleep(delay, signal);
        continue;
      }
      throw mapped;
    }

    if (RETRYABLE_STATUS.has(response.status) && attempt < maxRetries) {
      const retryAfter = parseRetryAfter(response.headers.get('retry-after'));
      const delay = retryAfter ?? backoffMilliseconds(attempt, random);
      onRetry({
        attempt: attempt + 1,
        delay,
        reason: `HTTP_${response.status}`,
      });
      await sleep(delay, signal);
      continue;
    }

    if (!response.ok) {
      throw mapHttpStatus(response.status);
    }

    let data;
    try {
      data = await response.json();
    } catch {
      throw new CliError(
        'RESPONSE_SCHEMA_ERROR',
        '服务端成功响应不是合法 JSON。',
        { httpStatus: response.status },
      );
    }

    let valid = false;
    try {
      valid = validate(data);
    } catch {
      valid = false;
    }

    if (!valid) {
      throw new CliError(
        'RESPONSE_SCHEMA_ERROR',
        '服务端响应缺少命令所需的结构。',
        { httpStatus: response.status },
      );
    }

    return {
      data,
      retryCount: attempt,
    };
  }
}

async function fetchWithTimeoutAndRedirects({
  url,
  method,
  headers,
  body,
  timeoutMs,
  fetchImpl,
  signal,
}) {
  const timeoutController = new AbortController();
  const timer = setTimeout(
    () => timeoutController.abort(new Error('REQUEST_TIMEOUT')),
    timeoutMs,
  );
  timer.unref?.();

  const combinedController = new AbortController();
  const abortFromExternal = () =>
    combinedController.abort(signal?.reason ?? new Error('USER_CANCELLED'));
  const abortFromTimeout = () =>
    combinedController.abort(new Error('REQUEST_TIMEOUT'));

  if (signal?.aborted) {
    abortFromExternal();
  } else {
    signal?.addEventListener('abort', abortFromExternal, { once: true });
  }
  timeoutController.signal.addEventListener('abort', abortFromTimeout, {
    once: true,
  });

  try {
    let currentUrl = new URL(url);
    let currentHeaders = { ...headers };

    for (let redirects = 0; ; redirects += 1) {
      const response = await fetchImpl(currentUrl, {
        method,
        headers: currentHeaders,
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: 'manual',
        signal: combinedController.signal,
      });

      if (!isRedirect(response.status) || !response.headers.get('location')) {
        return response;
      }

      if (method !== 'GET' || redirects >= 3) {
        return response;
      }

      const nextUrl = new URL(response.headers.get('location'), currentUrl);
      if (nextUrl.origin !== currentUrl.origin) {
        currentHeaders = stripSensitiveHeaders(currentHeaders);
      }
      currentUrl = nextUrl;
    }
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abortFromExternal);
  }
}

function stripSensitiveHeaders(headers) {
  return Object.fromEntries(
    Object.entries(headers).filter(
      ([key]) => !SENSITIVE_HEADERS.has(key.toLowerCase()),
    ),
  );
}

function mapFetchError(error, { isWrite, signal }) {
  if (signal?.aborted) {
    return new CliError('CANCELLED', '用户取消了操作。', { cause: error });
  }

  const code = error?.cause?.code || error?.code;
  if (TLS_ERROR_CODES.has(code) || String(code).startsWith('ERR_TLS_')) {
    return new CliError('TLS_ERROR', 'TLS 连接或证书校验失败。', {
      cause: error,
    });
  }

  const isTimeout =
    error?.name === 'AbortError' ||
    error?.message === 'REQUEST_TIMEOUT' ||
    error?.cause?.message === 'REQUEST_TIMEOUT';

  if (isWrite) {
    return new CliError(
      'WRITE_RESULT_UNKNOWN',
      '请求发出后未能确认评论是否已创建，请人工检查后再决定是否重试。',
      { cause: error, retryable: false },
    );
  }

  if (isTimeout) {
    return new CliError('TIMEOUT', 'CodeHub 请求超时。', {
      cause: error,
      retryable: true,
    });
  }

  return new CliError('NETWORK_ERROR', '无法连接 CodeHub 服务。', {
    cause: error,
    retryable: true,
  });
}

function mapHttpStatus(status) {
  if (status === 400 || status === 422) {
    return new CliError('INVALID_ARGUMENT', '服务端拒绝了请求参数。', {
      httpStatus: status,
    });
  }
  if (status === 401) {
    return new CliError('AUTH_FAILED', 'CodeHub 认证失败。', {
      httpStatus: status,
    });
  }
  if (status === 403) {
    return new CliError('FORBIDDEN', '没有执行该操作的权限。', {
      httpStatus: status,
    });
  }
  if (status === 404) {
    return new CliError('NOT_FOUND', '请求的 CodeHub 资源不存在。', {
      httpStatus: status,
    });
  }
  if (status === 429) {
    return new CliError('RATE_LIMITED', 'CodeHub 请求受到限流。', {
      httpStatus: status,
      retryable: true,
    });
  }

  return new CliError('SERVER_ERROR', 'CodeHub 服务返回错误。', {
    httpStatus: status,
    retryable: status >= 500,
  });
}

function parseRetryAfter(value) {
  if (!value) {
    return null;
  }

  if (/^\d+$/.test(value)) {
    return Number(value) * 1_000;
  }

  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, date - Date.now());
}

function backoffMilliseconds(attempt, random) {
  const base = 250 * 2 ** attempt;
  return Math.round(base + base * 0.25 * random());
}

function isRedirect(status) {
  return status >= 300 && status < 400;
}

function sleepWithSignal(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new CliError('CANCELLED', '用户取消了操作。'));
      return;
    }

    const cleanup = () => signal?.removeEventListener('abort', onAbort);
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, milliseconds);
    const onAbort = () => {
      clearTimeout(timer);
      cleanup();
      reject(new CliError('CANCELLED', '用户取消了操作。'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
