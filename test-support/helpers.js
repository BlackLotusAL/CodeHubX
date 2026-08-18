export function captureIo({
  stdoutIsTTY = false,
  stderrIsTTY = false,
  columns = 100,
  env = {},
} = {}) {
  const capture = { stdout: '', stderr: '' };
  return {
    capture,
    io: {
      stdout: (value) => {
        capture.stdout += value;
      },
      stderr: (value) => {
        capture.stderr += value;
      },
      stdoutIsTTY,
      stderrIsTTY,
      columns,
      env,
    },
  };
}

export function validConfig(overrides = {}) {
  return {
    devuc: {
      endpoint: 'https://devuc.test/v2/w3tokens',
      appCode: 'devuc-app-code',
      ...overrides.devuc,
    },
    codehub: {
      endpoint: 'https://codehub.test/api/v4',
      appCode: 'codehub-app-code',
      ...overrides.codehub,
    },
  };
}

export function configStore(config = validConfig()) {
  return {
    path: '/config/codehub/config.json',
    init: async () => ({ created: true, config_path: '/config/codehub/config.json' }),
    load: async () => structuredClone(config),
  };
}

export function jsonResponse(status, data, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

export function parseSingleJson(text) {
  const value = JSON.parse(text);
  if (!text.endsWith('\n')) throw new Error('missing final newline');
  return value;
}

export function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
