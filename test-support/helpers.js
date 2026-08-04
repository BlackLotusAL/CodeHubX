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
  return { ...overrides };
}

export const TEST_CONFIG = Object.freeze({
  devuc: Object.freeze({
    endpoint: 'https://devuc.test/v2/w3tokens',
    appCode: 'devuc-app-code',
  }),
  codehub: Object.freeze({
    endpoint: 'https://codehub.test/api/v4',
    appCode: 'codehub-app-code',
    origin: 'https://codehub.test',
    host: 'codehub.test',
  }),
});

export class MemoryConfigStore {
  constructor(config = TEST_CONFIG) {
    this.config = config;
    this.loads = 0;
    this.initialisations = 0;
  }

  async load() {
    this.loads += 1;
    return this.config;
  }

  async init() {
    this.initialisations += 1;
    return {
      created: true,
      configPath: '/test/config/codehub/config.json',
    };
  }
}
