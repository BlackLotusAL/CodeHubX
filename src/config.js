import { DEFAULTS } from './constants.js';

export function loadConfig() {
  const apiBaseUrl = DEFAULTS.apiBaseUrl;
  const devucUrl = DEFAULTS.devucUrl;

  return {
    apiBaseUrl,
    apiAppCode: DEFAULTS.apiAppCode,
    apiOrigin: new URL(apiBaseUrl).origin,
    apiHost: new URL(apiBaseUrl).host,
    devucUrl,
    devucAppCode: DEFAULTS.devucAppCode,
  };
}
