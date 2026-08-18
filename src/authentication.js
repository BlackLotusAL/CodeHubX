import { requireCodehubConfig, requireDevucConfig } from './config.js';
import {
  AUTH_TYPES,
  DEVUC_REFRESH_LEEWAY_MS,
  DEVUC_VALIDITY_MS,
} from './constants.js';
import { devucCredential, privateCredential } from './credentials.js';
import { CliError } from './errors.js';

export function createAuthenticationSession({
  configStore,
  credentialStore,
  prompter,
  devucClientFactory,
  codehubOperationsFactory,
  timeoutMs,
  fetchImpl,
  now = Date.now,
  signal,
} = {}) {
  return Object.freeze({
    login,
    status,
    logout,
    codehub,
  });

  async function login() {
    const rawConfig = await configStore.load();
    const codehubConfig = requireCodehubConfig(rawConfig);
    const authenticationType = await prompter.chooseAuthenticationType({ signal });

    if (authenticationType === AUTH_TYPES.PRIVATE_TOKEN) {
      const token = await prompter.readPrivateToken({ signal });
      await credentialStore.save(codehubConfig.origin, privateCredential(token));
      return loginResult(codehubConfig.origin, authenticationType);
    }

    if (authenticationType === AUTH_TYPES.DEVUC) {
      const devucConfig = requireDevucConfig(rawConfig);
      const values = await prompter.readDevucCredentials({ signal });
      const token = await createConfiguredDevucClient(devucConfig).login(
        values.account,
        values.password,
      );
      await credentialStore.save(codehubConfig.origin, devucCredential({
        account: values.account,
        password: values.password,
        token,
        issuedAtMs: now(),
      }));
      return loginResult(codehubConfig.origin, authenticationType);
    }

    throw new CliError('INVALID_ARGUMENT');
  }

  async function status() {
    const codehubConfig = await loadCodehubConfig();
    const credential = await credentialStore.get(codehubConfig.origin);
    return {
      configured: Boolean(credential),
      authentication_type: credential?.authentication_type ?? null,
      api_host: codehubConfig.origin,
    };
  }

  async function logout() {
    const codehubConfig = await loadCodehubConfig();
    await credentialStore.clear(codehubConfig.origin);
    return {
      credential_helper_cleared: true,
      api_host: codehubConfig.origin,
    };
  }

  async function codehub() {
    const rawConfig = await configStore.load();
    const codehubConfig = requireCodehubConfig(rawConfig);
    let credential = await credentialStore.get(codehubConfig.origin);
    if (!credential) throw new CliError('AUTH_ERROR');

    if (shouldRefresh(credential)) {
      const devucConfig = requireDevucConfig(rawConfig);
      const token = await createConfiguredDevucClient(devucConfig).login(
        credential.account,
        credential.password,
      );
      credential = devucCredential({
        account: credential.account,
        password: credential.password,
        token,
        issuedAtMs: now(),
      });
      await credentialStore.save(codehubConfig.origin, credential);
    }

    return codehubOperationsFactory({
      codehub: codehubConfig,
      credential,
      timeoutMs,
      fetchImpl,
      signal,
    });
  }

  function shouldRefresh(credential) {
    return (
      credential.authentication_type === AUTH_TYPES.DEVUC &&
      now() >= credential.issued_at_ms + DEVUC_VALIDITY_MS - DEVUC_REFRESH_LEEWAY_MS
    );
  }

  function createConfiguredDevucClient(devuc) {
    return devucClientFactory({
      devuc,
      timeoutMs,
      fetchImpl,
      signal,
    });
  }

  async function loadCodehubConfig() {
    return requireCodehubConfig(await configStore.load());
  }
}

function loginResult(origin, authenticationType) {
  return {
    configured: true,
    authentication_type: authenticationType,
    api_host: origin,
  };
}
