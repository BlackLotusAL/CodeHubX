import { DEFAULTS } from './constants.js';
import { CliError } from './errors.js';
import { validateHttpsUrl } from './validation.js';

export function loadConfig(env = process.env) {
  const apiBaseUrl = validateHttpsUrl(
    env.CODEHUB_API_BASE_URL || DEFAULTS.apiBaseUrl,
    'CODEHUB_API_BASE_URL',
  );
  const devucUrl = validateHttpsUrl(
    env.CODEHUB_DEVUC_URL || DEFAULTS.devucUrl,
    'CODEHUB_DEVUC_URL',
  );
  const apiAppCode = env.CODEHUB_API_APP_CODE || DEFAULTS.apiAppCode;
  const devucAppCode = env.CODEHUB_DEVUC_APP_CODE || DEFAULTS.devucAppCode;

  if (!apiAppCode) {
    throw new CliError(
      'AUTH_REQUIRED',
      '缺少 CODEHUB_API_APP_CODE 配置。',
    );
  }
  if (!devucAppCode) {
    throw new CliError(
      'AUTH_REQUIRED',
      '缺少 CODEHUB_DEVUC_APP_CODE 配置。',
    );
  }

  return {
    apiBaseUrl,
    apiAppCode,
    apiOrigin: new URL(apiBaseUrl).origin,
    apiHost: new URL(apiBaseUrl).host,
    devucUrl,
    devucAppCode,
  };
}
