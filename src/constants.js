export const CLI_NAME = 'codehub';
export const CLI_VERSION = '0.1.0';
export const SUCCESS_ICON = '✓';
export const FAILURE_ICON = '✗';

export const AUTH_TYPES = Object.freeze({
  PRIVATE_TOKEN: 'private_token',
  DEVUC: 'devuc',
});

export const OUTPUT_FORMATS = Object.freeze(['json', 'human']);
export const MR_STATES = Object.freeze(['open', 'closed', 'locked', 'merged', 'all']);
export const SEVERITIES = Object.freeze(['suggestion', 'minor', 'major', 'fatal']);

export const DEFAULT_TIMEOUT = '30s';
export const DEVUC_VALIDITY_MS = 24 * 60 * 60 * 1_000;
export const DEVUC_REFRESH_LEEWAY_MS = 5 * 60 * 1_000;
