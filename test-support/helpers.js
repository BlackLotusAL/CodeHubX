export function captureIo() {
  let stdout = '';
  let stderr = '';
  return {
    io: {
      stdout: (value) => {
        stdout += value;
      },
      stderr: (value) => {
        stderr += value;
      },
    },
    stdout: () => stdout,
    stderr: () => stderr,
  };
}

export class MemoryCredentialStore {
  constructor(initial = null) {
    this.credential = initial;
    this.saved = [];
    this.cleared = false;
  }

  async get() {
    return this.credential;
  }

  async save(_host, authType, token) {
    this.credential = {
      authType,
      token,
      source: 'credential_helper',
    };
    this.saved.push({ authType, token });
  }

  async clear() {
    this.credential = null;
    this.cleared = true;
  }
}

export function jsonResponse(value, init = {}) {
  return new Response(JSON.stringify(value), {
    status: init.status ?? 200,
    headers: {
      'content-type': 'application/json',
      ...init.headers,
    },
  });
}

export function testEnv(overrides = {}) {
  return {
    CODEHUB_API_BASE_URL: 'https://codehub.test/api/v4',
    CODEHUB_API_APP_CODE: 'api-app-code',
    CODEHUB_DEVUC_URL: 'https://devuc.test/token',
    CODEHUB_DEVUC_APP_CODE: 'devuc-app-code',
    ...overrides,
  };
}
