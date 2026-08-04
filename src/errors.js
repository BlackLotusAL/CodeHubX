const EXIT_CODE_BY_ERROR = Object.freeze({
  INVALID_ARGUMENT: 2,
  CONFIG_REQUIRED: 3,
  CONFIG_INVALID: 3,
  CONFIG_ERROR: 3,
  CONFIG_CONFLICT: 3,
  AUTH_REQUIRED: 3,
  AUTH_FAILED: 3,
  CREDENTIAL_ERROR: 3,
  FORBIDDEN: 4,
  POLICY_DENIED: 4,
  NOT_FOUND: 5,
  RATE_LIMITED: 7,
  TIMEOUT: 8,
  NETWORK_ERROR: 8,
  TLS_ERROR: 8,
  WRITE_RESULT_UNKNOWN: 8,
  SERVER_ERROR: 9,
  RESPONSE_SCHEMA_ERROR: 9,
  UNSUPPORTED_CAPABILITY: 10,
  CANCELLED: 130,
});

export class CliError extends Error {
  constructor(code, message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = 'CliError';
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.httpStatus = options.httpStatus ?? null;
    this.details = options.details ?? {};
    this.exitCode = options.exitCode ?? EXIT_CODE_BY_ERROR[code] ?? 9;
  }
}

export function toCliError(error) {
  if (error instanceof CliError) {
    return error;
  }

  if (error?.code?.startsWith?.('commander.')) {
    return new CliError('INVALID_ARGUMENT', normaliseCommanderMessage(error.message), {
      exitCode: 2,
    });
  }

  return new CliError('SERVER_ERROR', 'CLI 发生未预期的内部错误。', {
    cause: error,
  });
}

function normaliseCommanderMessage(message) {
  const text = String(message ?? '');

  if (text.includes('unknown option')) {
    return '包含未知参数，请使用 --help 查看命令用法。';
  }
  if (text.includes('missing required argument')) {
    return '缺少必填参数，请使用 --help 查看命令用法。';
  }
  if (text.includes('required option')) {
    return '缺少必填选项，请使用 --help 查看命令用法。';
  }
  if (text.includes('too many arguments')) {
    return '参数数量过多，请使用 --help 查看命令用法。';
  }
  if (text.includes('cannot be used with option')) {
    return '使用了互斥选项，请使用 --help 查看命令用法。';
  }

  return '命令参数无效，请使用 --help 查看命令用法。';
}
