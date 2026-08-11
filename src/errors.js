const EXIT_CODE_BY_ERROR = Object.freeze({
  INVALID_ARGUMENT: 2,
  CONFIG_ERROR: 3,
  AUTH_ERROR: 3,
  HTTP_ERROR: 4,
  NETWORK_ERROR: 8,
  WRITE_RESULT_UNKNOWN: 8,
  CANCELLED: 130,
});

const JSON_MESSAGE_BY_ERROR = Object.freeze({
  INVALID_ARGUMENT: 'Invalid command argument.',
  CONFIG_ERROR: 'CodeHub configuration is unavailable.',
  AUTH_ERROR: 'CodeHub authentication failed.',
  HTTP_ERROR: 'CodeHub request failed.',
  NETWORK_ERROR: 'CodeHub request failed due to a network error.',
  WRITE_RESULT_UNKNOWN: 'The comment request result is unknown.',
  CANCELLED: 'Operation cancelled.',
});

const HUMAN_MESSAGE_BY_ERROR = Object.freeze({
  INVALID_ARGUMENT: '命令参数无效。',
  CONFIG_ERROR: 'CodeHub 配置不可用。',
  AUTH_ERROR: 'CodeHub 认证失败。',
  HTTP_ERROR: 'CodeHub 请求失败。',
  NETWORK_ERROR: 'CodeHub 网络请求失败。',
  WRITE_RESULT_UNKNOWN: '无法确认评论是否创建成功，请人工检查后再决定是否重试。',
  CANCELLED: '操作已取消。',
});

export class CliError extends Error {
  constructor(code, options = {}) {
    super(options.internalMessage ?? JSON_MESSAGE_BY_ERROR[code], {
      cause: options.cause,
    });
    this.name = 'CliError';
    this.code = code;
    this.exitCode = EXIT_CODE_BY_ERROR[code] ?? 4;
    this.jsonMessage = options.jsonMessage ?? JSON_MESSAGE_BY_ERROR[code];
    this.humanMessage = options.humanMessage ?? HUMAN_MESSAGE_BY_ERROR[code];
    this.httpStatus = options.httpStatus ?? null;
  }
}

export function toCliError(error) {
  if (error instanceof CliError) return error;

  if (error?.code?.startsWith?.('commander.')) {
    return new CliError('INVALID_ARGUMENT', { cause: error });
  }

  if (error?.name === 'AbortError' || error?.message === 'USER_CANCELLED') {
    return new CliError('CANCELLED', { cause: error });
  }

  return new CliError('HTTP_ERROR', { cause: error });
}

export function errorResult(error) {
  const result = {
    code: error.code,
    message: error.jsonMessage,
  };
  if (error.httpStatus !== null) result.http_status = error.httpStatus;
  return result;
}

export function humanErrorMessage(error) {
  const status = error.httpStatus === null ? '' : `（HTTP ${error.httpStatus}）`;
  return `[${error.code}] ${error.humanMessage}${status}`;
}
