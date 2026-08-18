import { homedir } from 'node:os';
import { dirname, posix, win32 } from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { CliError } from './errors.js';

export const CONFIG_TEMPLATE = Object.freeze({
  devuc: Object.freeze({ endpoint: '', appCode: '' }),
  codehub: Object.freeze({ endpoint: '', appCode: '' }),
});

export function resolveConfigPath({
  platform = process.platform,
  env = process.env,
  homeDirectory = homedir(),
} = {}) {
  if (platform === 'win32') {
    const root =
      env.APPDATA && win32.isAbsolute(env.APPDATA)
        ? env.APPDATA
        : win32.join(homeDirectory, 'AppData', 'Roaming');
    return win32.join(root, 'codehub', 'config.json');
  }

  const root =
    env.XDG_CONFIG_HOME && posix.isAbsolute(env.XDG_CONFIG_HOME)
      ? env.XDG_CONFIG_HOME
      : posix.join(homeDirectory, '.config');
  return posix.join(root, 'codehub', 'config.json');
}

export function createConfigStore({
  path = resolveConfigPath(),
  read = readFile,
  write = writeFile,
  makeDirectory = mkdir,
} = {}) {
  return {
    path,

    async init() {
      try {
        await makeDirectory(dirname(path), { recursive: true, mode: 0o700 });
        await write(path, `${JSON.stringify(CONFIG_TEMPLATE, null, 2)}\n`, {
          encoding: 'utf8',
          flag: 'wx',
          mode: 0o600,
        });
        return { created: true, config_path: path };
      } catch (error) {
        if (error?.code === 'EEXIST') {
          return { created: false, config_path: path };
        }
        throw new CliError('CONFIG_ERROR', { cause: error });
      }
    },

    async load() {
      try {
        const text = await read(path, 'utf8');
        return JSON.parse(String(text).replace(/^\uFEFF/, ''));
      } catch (error) {
        throw new CliError('CONFIG_ERROR', { cause: error });
      }
    },
  };
}

export function requireCodehubConfig(config) {
  return requireServiceConfig(config, 'codehub');
}

export function requireDevucConfig(config) {
  return requireServiceConfig(config, 'devuc');
}

function requireServiceConfig(config, key) {
  try {
    const source = config?.[key];
    if (source === null || typeof source !== 'object' || Array.isArray(source)) {
      throw new Error('INVALID_SERVICE');
    }
    if (
      typeof source.endpoint !== 'string' ||
      source.endpoint.length === 0 ||
      typeof source.appCode !== 'string' ||
      source.appCode.trim().length === 0 ||
      /[\u0000-\u001F\u007F]/.test(source.appCode)
    ) {
      throw new Error('INVALID_VALUE');
    }

    const url = new URL(source.endpoint);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.hash ||
      (key === 'codehub' && url.search)
    ) {
      throw new Error('INVALID_URL');
    }

    return Object.freeze({
      endpoint: url.toString(),
      appCode: source.appCode,
      origin: url.origin,
    });
  } catch (error) {
    if (error instanceof CliError) throw error;
    throw new CliError('CONFIG_ERROR', { cause: error });
  }
}
