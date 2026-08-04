import {
  mkdir as mkdirFile,
  readFile as readFileContents,
  writeFile as writeFileContents,
} from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, posix, win32 } from 'node:path';
import { CliError } from './errors.js';

const DEFAULT_CONFIG_URL = new URL('../config/default.json', import.meta.url);
const REQUIRED_ROOT_FIELDS = Object.freeze(['devuc', 'codehub']);
const REQUIRED_SERVICE_FIELDS = Object.freeze(['endpoint', 'appCode']);

export function createConfigStore({
  env = process.env,
  platform = process.platform,
  homeDirectory = homedir(),
  readFile = readFileContents,
  mkdir = mkdirFile,
  writeFile = writeFileContents,
  readDefaultConfig = () => readFileContents(DEFAULT_CONFIG_URL, 'utf8'),
} = {}) {
  const configPath = resolveConfigPath({ env, platform, homeDirectory });

  return {
    path: configPath,

    async load() {
      return readAndValidateConfig(configPath, readFile);
    },

    async init() {
      const existing = await readIfPresent(configPath, readFile);
      if (existing !== null) {
        parseAndValidateConfig(existing, configPath);
        return { created: false, configPath };
      }

      let defaultText;
      try {
        defaultText = await readDefaultConfig();
      } catch (error) {
        throw configError('无法读取 CLI 内置的默认配置。', configPath, error);
      }
      const defaultConfig = parseAndValidateConfig(
        defaultText,
        'bundled default config',
      );
      const serialised = `${JSON.stringify(configFileShape(defaultConfig), null, 2)}\n`;

      try {
        await mkdir(dirname(configPath), { recursive: true, mode: 0o700 });
        await writeFile(configPath, serialised, {
          encoding: 'utf8',
          flag: 'wx',
          mode: 0o600,
        });
        return { created: true, configPath };
      } catch (error) {
        if (error?.code === 'EEXIST') {
          await readAndValidateConfig(configPath, readFile);
          return { created: false, configPath };
        }
        throw configError('无法创建用户配置文件。', configPath, error);
      }
    },
  };
}

export function resolveConfigPath({
  env = process.env,
  platform = process.platform,
  homeDirectory = homedir(),
} = {}) {
  if (typeof homeDirectory !== 'string' || homeDirectory.length === 0) {
    throw configError('无法确定当前用户的主目录。');
  }

  if (platform === 'win32') {
    const appDataDirectory = env.APPDATA;
    const baseDirectory =
      typeof appDataDirectory === 'string' &&
      appDataDirectory.length > 0 &&
      win32.isAbsolute(appDataDirectory)
        ? appDataDirectory
        : win32.join(homeDirectory, 'AppData', 'Roaming');
    return win32.join(baseDirectory, 'codehub', 'config.json');
  }

  const xdgDirectory = env.XDG_CONFIG_HOME;
  const baseDirectory =
    typeof xdgDirectory === 'string' &&
    xdgDirectory.length > 0 &&
    posix.isAbsolute(xdgDirectory)
      ? xdgDirectory
      : posix.join(homeDirectory, '.config');
  return posix.join(baseDirectory, 'codehub', 'config.json');
}

export function parseAndValidateConfig(text, configPath = 'config.json') {
  let value;
  try {
    value = JSON.parse(String(text).replace(/^\uFEFF/, ''));
  } catch (error) {
    throw invalidConfig('配置文件不是合法的 JSON。', configPath, error);
  }

  assertExactObject(value, REQUIRED_ROOT_FIELDS, '配置根对象', configPath);
  const devuc = validateService(value.devuc, 'devuc', configPath);
  const codehub = validateService(value.codehub, 'codehub', configPath);

  return Object.freeze({
    devuc: Object.freeze(devuc),
    codehub: Object.freeze({
      ...codehub,
      origin: new URL(codehub.endpoint).origin,
      host: new URL(codehub.endpoint).host,
    }),
  });
}

async function readAndValidateConfig(configPath, readFile) {
  let text;
  try {
    text = await readFile(configPath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new CliError(
        'CONFIG_REQUIRED',
        '尚未初始化 CodeHub 配置，请先执行 codehub config init。',
        { details: { config_path: configPath } },
      );
    }
    throw configError('无法读取用户配置文件。', configPath, error);
  }
  return parseAndValidateConfig(text, configPath);
}

async function readIfPresent(configPath, readFile) {
  try {
    return await readFile(configPath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return null;
    }
    throw configError('无法读取用户配置文件。', configPath, error);
  }
}

function validateService(value, name, configPath) {
  assertExactObject(value, REQUIRED_SERVICE_FIELDS, name, configPath);
  const endpoint = validateEndpoint(value.endpoint, `${name}.endpoint`, configPath);
  const appCode = validateAppCode(value.appCode, `${name}.appCode`, configPath);
  return { endpoint, appCode };
}

function validateEndpoint(value, field, configPath) {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim()) {
    throw invalidConfig(`${field} 必须是非空 HTTPS URL。`, configPath);
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch (error) {
    throw invalidConfig(`${field} 必须是合法的 HTTPS URL。`, configPath, error);
  }

  if (
    parsed.protocol !== 'https:' ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw invalidConfig(
      `${field} 必须使用 HTTPS，且不能包含凭据、query 或 fragment。`,
      configPath,
    );
  }
  return value;
}

function validateAppCode(value, field, configPath) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value !== value.trim() ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw invalidConfig(`${field} 不是合法的 HTTP Header 值。`, configPath);
  }
  return value;
}

function assertExactObject(value, requiredFields, label, configPath) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw invalidConfig(`${label} 必须是对象。`, configPath);
  }

  const fields = Object.keys(value);
  const missing = requiredFields.filter((field) => !fields.includes(field));
  const unknown = fields.filter((field) => !requiredFields.includes(field));
  if (missing.length > 0 || unknown.length > 0) {
    throw invalidConfig(`${label} 的字段不完整或包含未知字段。`, configPath);
  }
}

function configFileShape(config) {
  return {
    devuc: {
      endpoint: config.devuc.endpoint,
      appCode: config.devuc.appCode,
    },
    codehub: {
      endpoint: config.codehub.endpoint,
      appCode: config.codehub.appCode,
    },
  };
}

function invalidConfig(message, configPath, cause) {
  return new CliError('CONFIG_INVALID', message, {
    cause,
    details: configPath ? { config_path: configPath } : {},
  });
}

function configError(message, configPath, cause) {
  return new CliError('CONFIG_ERROR', message, {
    cause,
    details: configPath ? { config_path: configPath } : {},
  });
}
