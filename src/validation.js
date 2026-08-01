import { CliError } from './errors.js';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const POSITIVE_INTEGER_PATTERN = /^[1-9]\d*$/;
const TIMEOUT_PATTERN = /^([1-9]\d*)(ms|s|m)$/;
const ACCOUNT_PATTERN = /^[A-Za-z0-9]+$/;

export function parsePositiveId(value, label) {
  if (!POSITIVE_INTEGER_PATTERN.test(String(value ?? ''))) {
    throw new CliError('INVALID_ARGUMENT', `${label} 必须是正整数字符串。`);
  }

  return String(value);
}

export function validateRequestId(value) {
  if (!REQUEST_ID_PATTERN.test(String(value ?? ''))) {
    throw new CliError(
      'INVALID_ARGUMENT',
      'request ID 只能包含字母、数字、点、下划线、冒号和连字符，长度为 1～128。',
    );
  }

  return String(value);
}

export function isValidRequestId(value) {
  return REQUEST_ID_PATTERN.test(String(value ?? ''));
}

export function parseTimeout(value) {
  const match = TIMEOUT_PATTERN.exec(String(value ?? ''));
  if (!match) {
    throw new CliError(
      'INVALID_ARGUMENT',
      'timeout 必须是正整数加 ms、s 或 m，例如 500ms、30s、2m。',
    );
  }

  const amount = Number(match[1]);
  const multiplier = match[2] === 'ms' ? 1 : match[2] === 's' ? 1_000 : 60_000;
  const milliseconds = amount * multiplier;

  if (!Number.isSafeInteger(milliseconds)) {
    throw new CliError('INVALID_ARGUMENT', 'timeout 数值过大。');
  }

  return milliseconds;
}

export function validateOutput(value) {
  if (value !== 'json' && value !== 'human') {
    throw new CliError('INVALID_ARGUMENT', 'output 只接受 json 或 human。');
  }
  return value;
}

export function validateState(value) {
  const states = new Map([
    ['open', 'opened'],
    ['closed', 'closed'],
    ['locked', 'locked'],
    ['merged', 'merged'],
    ['all', 'all'],
  ]);

  if (!states.has(value)) {
    throw new CliError(
      'INVALID_ARGUMENT',
      'state 只接受 open、closed、locked、merged 或 all。',
    );
  }

  return states.get(value);
}

export function validateSeverity(value) {
  const allowed = new Set(['suggestion', 'minor', 'major', 'fatal']);
  if (!allowed.has(value)) {
    throw new CliError(
      'INVALID_ARGUMENT',
      'severity 只接受 suggestion、minor、major 或 fatal。',
    );
  }
  return value;
}

export function validateAccount(value) {
  if (!ACCOUNT_PATTERN.test(String(value ?? ''))) {
    throw new CliError('INVALID_ARGUMENT', 'DevUC account 只能包含字母和数字。');
  }
  return String(value);
}
