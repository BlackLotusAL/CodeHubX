import { InvalidArgumentError } from 'commander';
import { MR_STATES, OUTPUT_FORMATS, SEVERITIES } from './constants.js';
import { CliError } from './errors.js';

const POSITIVE_ID = /^[1-9]\d*$/;
const DURATION = /^([1-9]\d*)(ms|s|m)$/;

export function positiveId(value) {
  if (typeof value !== 'string' || !POSITIVE_ID.test(value)) {
    throw new CliError('INVALID_ARGUMENT');
  }
  return value;
}

export function commanderPositiveId(value) {
  if (!POSITIVE_ID.test(value)) {
    throw new InvalidArgumentError('必须为正整数字符串');
  }
  return value;
}

export function parseTimeout(value) {
  const match = typeof value === 'string' ? DURATION.exec(value) : null;
  if (!match) throw new CliError('INVALID_ARGUMENT');

  const amount = Number(match[1]);
  const multiplier = match[2] === 'ms' ? 1 : match[2] === 's' ? 1_000 : 60_000;
  const milliseconds = amount * multiplier;
  if (!Number.isSafeInteger(milliseconds) || milliseconds <= 0) {
    throw new CliError('INVALID_ARGUMENT');
  }
  return milliseconds;
}

export function outputFormat(value) {
  if (!OUTPUT_FORMATS.includes(value)) throw new CliError('INVALID_ARGUMENT');
  return value;
}

export function mergeRequestState(value) {
  if (!MR_STATES.includes(value)) throw new CliError('INVALID_ARGUMENT');
  return value === 'open' ? 'opened' : value;
}

export function severity(value) {
  if (!SEVERITIES.includes(value)) throw new CliError('INVALID_ARGUMENT');
  return value;
}

export function commentBody(value) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new CliError('INVALID_ARGUMENT');
  }
  return value;
}

export function privateToken(value) {
  if (typeof value !== 'string' || value.length === 0 || /[\r\n\0]/.test(value)) {
    throw new CliError('INVALID_ARGUMENT');
  }
  return value;
}

export function devucAccount(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9]+$/.test(value)) {
    throw new CliError('INVALID_ARGUMENT');
  }
  return value;
}

export function devucPassword(value) {
  if (typeof value !== 'string' || value.length === 0 || /[\r\n\0]/.test(value)) {
    throw new CliError('INVALID_ARGUMENT');
  }
  return value;
}
