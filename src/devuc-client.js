import { CliError } from './errors.js';
import { requestJson } from './http.js';

export function createDevucClient({
  devuc,
  timeoutMs,
  fetchImpl,
  signal,
} = {}) {
  return Object.freeze({ login });

  async function login(account, password) {
    if (!devuc) throw new CliError('CONFIG_ERROR');
    try {
      const data = await requestJson({
        url: devuc.endpoint,
        method: 'POST',
        headers: {
          'X-Apig-AppCode': devuc.appCode,
          'Content-Type': 'application/json',
        },
        body: { account, password },
        timeoutMs,
        fetchImpl,
        signal,
        validate: isObject,
      });
      const token = data?.result?.newToken;
      if (typeof token !== 'string' || token.length === 0 || /[\r\n\0]/.test(token)) {
        throw new CliError('AUTH_ERROR');
      }
      return token;
    } catch (error) {
      if (error instanceof CliError && error.code === 'CANCELLED') throw error;
      throw new CliError('AUTH_ERROR', {
        cause: error,
        httpStatus: error?.httpStatus ?? null,
      });
    }
  }
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
