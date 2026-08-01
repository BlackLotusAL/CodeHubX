export const CLI_VERSION = '0.1.0';
export const SCHEMA_VERSION = 'codehub.cli/v1';

export const DEFAULTS = Object.freeze({
  apiBaseUrl:
    'https://repo-api-codeartsx-cn-southwest-2.sicarrier.com/api/v4',
  apiAppCode:
    '92da42a0761f48e6877531ec4fadeaa91ed7f1bddbb9491dbd3d543217173e68',
  devucUrl: 'https://devuc.sicarrier.com/ssoproxysvr/v2/w3tokens',
  devucAppCode:
    'b7556594b93342d7a5b897f87a934dee89198a5ee7754799b9e8b998899c53cf',
  timeout: '30s',
});

export const AUTH_TYPES = Object.freeze({
  PRIVATE_TOKEN: 'private_token',
  X_AUTH_TOKEN: 'x_auth_token',
});

export const WARNING = Object.freeze({
  PARTIAL_LIST_POSSIBLE: {
    code: 'PARTIAL_LIST_POSSIBLE',
    message: '服务端分页契约未知，返回的列表可能不是全量。',
  },
  UNSAFE_WRITE_GUARANTEES: {
    code: 'UNSAFE_WRITE_GUARANTEES',
    message:
      '服务端不支持条件写和幂等；无法保证评论对应最新 head，也无法阻止人工重试产生重复评论。',
  },
});
