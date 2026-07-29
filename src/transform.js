import { ID_FIELDS } from './constants.js';

export function stringifyKnownIds(value) {
  if (Array.isArray(value)) {
    return value.map(stringifyKnownIds);
  }

  if (value === null || typeof value !== 'object') {
    return value;
  }

  const transformed = {};
  for (const [key, child] of Object.entries(value)) {
    if (
      ID_FIELDS.has(key) &&
      typeof child === 'number' &&
      Number.isFinite(child)
    ) {
      transformed[key] = String(child);
    } else {
      transformed[key] = stringifyKnownIds(child);
    }
  }

  return transformed;
}

export function sanitiseForOutput(value, sensitiveValues = []) {
  const secrets = [...sensitiveValues].filter(
    (secret) => typeof secret === 'string' && secret.length > 0,
  );
  return sanitise(value, secrets);
}

function sanitise(value, secrets) {
  if (Array.isArray(value)) {
    return value.map((child) => sanitise(child, secrets));
  }

  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        sanitise(child, secrets),
      ]),
    );
  }

  if (typeof value !== 'string') {
    return value;
  }

  let output = stripUrlCredentials(value);
  for (const secret of secrets) {
    output = output.replaceAll(secret, '[REDACTED]');
  }
  return output;
}

function stripUrlCredentials(value) {
  if (!/^[A-Za-z][A-Za-z\d+.-]*:\/\//.test(value)) {
    return value;
  }

  try {
    const url = new URL(value);
    if (!url.username && !url.password) {
      return value;
    }
    url.username = '';
    url.password = '';
    return url.toString();
  } catch {
    return value;
  }
}
