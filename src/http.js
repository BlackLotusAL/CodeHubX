import { CliError } from './errors.js';

const MAX_REDIRECTS = 5;
const SENSITIVE_HEADERS = new Set([
  'private-token',
  'x-auth-token',
  'x-apig-appcode',
  'authorization',
  'cookie',
]);
const DEFINITELY_BEFORE_SEND_CODES = new Set([
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'CERT_HAS_EXPIRED',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
]);

export async function requestJson({
  url,
  method = 'GET',
  headers = {},
  body,
  timeoutMs,
  fetchImpl = globalThis.fetch,
  signal,
  validate = () => true,
  isCommentWrite = false,
}) {
  const timeoutController = new AbortController();
  const combinedController = new AbortController();
  const abortFromCaller = () => combinedController.abort(signal?.reason ?? new Error('USER_CANCELLED'));
  const abortFromTimeout = () => combinedController.abort(new Error('REQUEST_TIMEOUT'));
  const timer = setTimeout(() => timeoutController.abort(), timeoutMs);

  if (signal?.aborted) abortFromCaller();
  else signal?.addEventListener('abort', abortFromCaller, { once: true });
  timeoutController.signal.addEventListener('abort', abortFromTimeout, { once: true });

  try {
    let currentUrl = new URL(url);
    let currentHeaders = { ...headers };

    for (let redirects = 0; ; redirects += 1) {
      let response;
      try {
        response = await fetchImpl(currentUrl, {
          method,
          headers: currentHeaders,
          body: body === undefined ? undefined : JSON.stringify(body),
          redirect: 'manual',
          signal: combinedController.signal,
        });
      } catch (error) {
        throw mapNetworkError(error, {
          signal,
          timedOut: timeoutController.signal.aborted,
          isCommentWrite,
        });
      }

      if (isRedirect(response.status)) {
        const location = response.headers.get('location');
        if (method !== 'GET' || !location || redirects >= MAX_REDIRECTS) {
          throw httpError(response.status);
        }

        const nextUrl = new URL(location, currentUrl);
        if (nextUrl.origin !== currentUrl.origin) {
          currentHeaders = stripSensitiveHeaders(currentHeaders);
        }
        currentUrl = nextUrl;
        continue;
      }

      if (!response.ok) throw httpError(response.status);

      let text;
      try {
        text = await response.text();
      } catch (error) {
        if (signal?.aborted) throw new CliError('CANCELLED', { cause: error });
        if (isCommentWrite) throw new CliError('WRITE_RESULT_UNKNOWN', { cause: error });
        throw new CliError('HTTP_ERROR', {
          httpStatus: response.status,
          cause: error,
        });
      }

      let data;
      try {
        data = JSON.parse(text);
      } catch (error) {
        throw new CliError('HTTP_ERROR', {
          httpStatus: response.status,
          cause: error,
        });
      }

      let usable = false;
      try {
        usable = Boolean(validate(data));
      } catch {
        usable = false;
      }
      if (!usable) {
        throw new CliError('HTTP_ERROR', { httpStatus: response.status });
      }
      return data;
    }
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abortFromCaller);
  }
}

export function stripSensitiveHeaders(headers) {
  return Object.fromEntries(
    Object.entries(headers).filter(([name]) => !SENSITIVE_HEADERS.has(name.toLowerCase())),
  );
}

function mapNetworkError(error, { signal, timedOut, isCommentWrite }) {
  if (signal?.aborted) return new CliError('CANCELLED', { cause: error });

  const code = error?.cause?.code ?? error?.code;
  if (isCommentWrite && !DEFINITELY_BEFORE_SEND_CODES.has(code)) {
    return new CliError('WRITE_RESULT_UNKNOWN', { cause: error });
  }

  if (timedOut && isCommentWrite) {
    return new CliError('WRITE_RESULT_UNKNOWN', { cause: error });
  }
  return new CliError('NETWORK_ERROR', { cause: error });
}

function httpError(status) {
  return new CliError(status === 401 ? 'AUTH_ERROR' : 'HTTP_ERROR', {
    httpStatus: status,
  });
}

function isRedirect(status) {
  return status >= 300 && status < 400;
}
