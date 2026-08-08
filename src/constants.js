export const CLI_VERSION = '0.1.0';
export const SCHEMA_VERSION = 'codehub.cli/v1';

export const DEFAULTS = Object.freeze({
  timeout: '30s',
});

export const AUTH_TYPES = Object.freeze({
  PRIVATE_TOKEN: 'private_token',
  X_AUTH_TOKEN: 'x_auth_token',
});

export const WARNING = Object.freeze({
  SIMULATION_MODE: {
    code: 'SIMULATION_MODE',
    message: '当前命令使用内置仿真数据，未读取真实配置或凭据，也未访问 CodeHub 服务。',
  },
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
