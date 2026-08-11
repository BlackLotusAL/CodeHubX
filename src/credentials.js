import { Entry } from '@napi-rs/keyring';
import { AUTH_TYPES } from './constants.js';
import { CliError } from './errors.js';

const SERVICE = 'codehub-cli';
const RECORD_VERSION = 1;

export class KeyringCredentialStore {
  constructor({ EntryClass = Entry, service = SERVICE } = {}) {
    this.EntryClass = EntryClass;
    this.service = service;
  }

  async get(origin) {
    let password;
    try {
      password = new this.EntryClass(this.service, origin).getPassword();
    } catch (error) {
      if (isMissingCredential(error)) return null;
      throw credentialError(error);
    }

    if (password === null || password === undefined || password === '') return null;
    return parseCredentialRecord(password);
  }

  async save(origin, credential) {
    const record = serialiseCredentialRecord(credential);
    try {
      new this.EntryClass(this.service, origin).setPassword(record);
    } catch (error) {
      throw credentialError(error);
    }
  }

  async clear(origin) {
    try {
      new this.EntryClass(this.service, origin).deletePassword();
    } catch (error) {
      if (!isMissingCredential(error)) throw credentialError(error);
    }
  }
}

export class MemoryCredentialStore {
  constructor(entries = []) {
    this.records = new Map(entries);
  }

  async get(origin) {
    const record = this.records.get(origin);
    return record ? structuredClone(record) : null;
  }

  async save(origin, credential) {
    this.records.set(origin, structuredClone(validateCredential(credential)));
  }

  async clear(origin) {
    this.records.delete(origin);
  }
}

export function privateCredential(token) {
  return validateCredential({
    version: RECORD_VERSION,
    authentication_type: AUTH_TYPES.PRIVATE_TOKEN,
    token,
  });
}

export function devucCredential({ account, password, token, issuedAtMs }) {
  return validateCredential({
    version: RECORD_VERSION,
    authentication_type: AUTH_TYPES.DEVUC,
    account,
    password,
    token,
    issued_at_ms: issuedAtMs,
  });
}

export function credentialSecrets(credential) {
  if (!credential) return [];
  return [credential.account, credential.password, credential.token].filter(
    (value) => typeof value === 'string' && value.length > 0,
  );
}

export function serialiseCredentialRecord(credential) {
  return JSON.stringify(validateCredential(credential));
}

export function parseCredentialRecord(value) {
  try {
    return validateCredential(JSON.parse(value));
  } catch (error) {
    if (error instanceof CliError) throw error;
    throw credentialError(error);
  }
}

function validateCredential(credential) {
  if (
    credential === null ||
    typeof credential !== 'object' ||
    Array.isArray(credential) ||
    credential.version !== RECORD_VERSION ||
    !validSecret(credential.token)
  ) {
    throw credentialError();
  }

  if (credential.authentication_type === AUTH_TYPES.PRIVATE_TOKEN) {
    return Object.freeze({
      version: RECORD_VERSION,
      authentication_type: AUTH_TYPES.PRIVATE_TOKEN,
      token: credential.token,
    });
  }

  if (
    credential.authentication_type === AUTH_TYPES.DEVUC &&
    typeof credential.account === 'string' &&
    /^[A-Za-z0-9]+$/.test(credential.account) &&
    validSecret(credential.password) &&
    Number.isSafeInteger(credential.issued_at_ms) &&
    credential.issued_at_ms >= 0
  ) {
    return Object.freeze({
      version: RECORD_VERSION,
      authentication_type: AUTH_TYPES.DEVUC,
      account: credential.account,
      password: credential.password,
      token: credential.token,
      issued_at_ms: credential.issued_at_ms,
    });
  }

  throw credentialError();
}

function validSecret(value) {
  return typeof value === 'string' && value.length > 0 && !/[\r\n\0]/.test(value);
}

function isMissingCredential(error) {
  const value = `${error?.code ?? ''} ${error?.name ?? ''} ${error?.message ?? ''}`;
  return /no\s*entry|not\s*found|missing|NoEntry/i.test(value);
}

function credentialError(cause) {
  return new CliError('AUTH_ERROR', { cause });
}
