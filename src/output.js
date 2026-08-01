import { SCHEMA_VERSION } from './constants.js';

export function successEnvelope(command, requestId, data, warnings = []) {
  return {
    schema_version: SCHEMA_VERSION,
    command,
    request_id: requestId,
    data,
    warnings,
  };
}

export function errorEnvelope(command, requestId, error) {
  return {
    schema_version: SCHEMA_VERSION,
    command,
    request_id: requestId,
    error: {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      http_status: error.httpStatus,
      details: error.details,
    },
  };
}

export function writeSuccess(io, format, envelope) {
  if (format === 'json') {
    io.stdout(`${JSON.stringify(envelope)}\n`);
    return;
  }

  io.stdout(`${renderHuman(envelope.command, envelope.data, envelope.warnings)}\n`);
}

export function writeError(io, format, envelope) {
  if (format === 'json') {
    io.stderr(`${JSON.stringify(envelope)}\n`);
    return;
  }

  const status = envelope.error.http_status
    ? ` (HTTP ${envelope.error.http_status})`
    : '';
  io.stderr(
    `错误 [${envelope.error.code}]${status}: ${envelope.error.message}\n`,
  );
}

function renderHuman(command, data, warnings) {
  const sections = [];

  switch (command) {
    case 'version':
      sections.push(
        [
          `CodeHub CLI: ${data.cli_version}`,
          `机器协议: ${data.protocol_version}`,
          `Node.js: ${data.node_version}`,
          `平台: ${data.platform}/${data.arch}`,
        ].join('\n'),
      );
      break;
    case 'capabilities':
      sections.push(
        [
          `认证方式: ${data.authentication_methods.join(', ')}`,
          `读取命令: ${data.read_commands.join(', ')}`,
          `写入命令: ${data.write_commands.join(', ')}`,
          `稳定分页: ${yesNo(data.pagination_guaranteed)}`,
          `条件写: ${yesNo(data.conditional_write)}`,
          `幂等写: ${yesNo(data.idempotent_write)}`,
          `行级评论: ${yesNo(data.inline_discussion)}`,
          `写入必须确认: ${yesNo(data.write_requires_confirmation)}`,
          `写入自动重试: ${yesNo(data.write_auto_retry)}`,
        ].join('\n'),
      );
      break;
    case 'auth.login':
      sections.push(
        `登录成功\n认证类型: ${data.authentication_type}\n凭据来源: ${data.credential_source}\nAPI: ${data.api_host}`,
      );
      break;
    case 'auth.status':
      sections.push(
        [
          `已配置凭据: ${yesNo(data.configured)}`,
          `凭据来源: ${data.credential_source ?? '-'}`,
          `认证类型: ${data.authentication_type ?? '-'}`,
          `API: ${data.api_host}`,
        ].join('\n'),
      );
      break;
    case 'auth.logout':
      sections.push('Credential Helper 中的 CodeHub 凭据已删除。');
      break;
    case 'repo.list':
      sections.push(renderTable(data, ['id', 'name', 'path_with_namespace', 'archived']));
      break;
    case 'repo.view':
      sections.push(renderKeyValues(data));
      break;
    case 'mr.list':
      sections.push(renderTable(data, ['iid', 'state', 'title', 'author', 'updated_at']));
      break;
    case 'mr.view':
      sections.push(renderKeyValues(data));
      break;
    case 'mr.commits':
      sections.push(renderTable(data, ['short_id', 'title', 'author_name', 'committed_date']));
      break;
    case 'mr.comment.create':
      if (data.dry_run) {
        sections.push(
          [
            '评论请求校验通过（dry-run，未发送网络请求）',
            `Project: ${data.project_id}`,
            `MR IID: ${data.merge_request_iid}`,
            `Severity: ${data.severity}`,
            `正文 UTF-8 字节数: ${data.body_utf8_bytes}`,
            `认证类型: ${data.authentication_type}`,
          ].join('\n'),
        );
      } else {
        sections.push(`评论创建成功\n${renderKeyValues(data)}`);
      }
      break;
    default:
      sections.push(JSON.stringify(data, null, 2));
  }

  if (warnings.length > 0) {
    sections.push(
      `警告:\n${warnings.map((warning) => `- [${warning.code}] ${warning.message}`).join('\n')}`,
    );
  }

  return sections.join('\n\n');
}

function renderKeyValues(value) {
  return Object.entries(value)
    .map(([key, child]) => {
      const rendered =
        child !== null && typeof child === 'object'
          ? JSON.stringify(child)
          : safeHumanText(child ?? '-');
      return `${key}: ${rendered}`;
    })
    .join('\n');
}

function renderTable(rows, columns) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return '没有结果。';
  }

  const values = rows.map((row) =>
    columns.map((column) => printableCell(row?.[column])),
  );
  const widths = columns.map((column, index) =>
    Math.min(
      48,
      Math.max(
        displayWidth(column),
        ...values.map((row) => displayWidth(row[index])),
      ),
    ),
  );
  const line = (cells) =>
    cells
      .map((cell, index) => padCell(truncate(cell, widths[index]), widths[index]))
      .join('  ');

  return [
    line(columns),
    line(widths.map((width) => '-'.repeat(width))),
    ...values.map(line),
  ].join('\n');
}

function printableCell(value) {
  if (value === null || value === undefined) {
    return '-';
  }
  if (typeof value === 'object') {
    return safeHumanText(value.username ?? value.name ?? value.id ?? '-');
  }
  return safeHumanText(value).replace(/[\r\n\t]+/g, ' ');
}

function displayWidth(value) {
  return [...String(value)].reduce(
    (width, character) => width + (character.codePointAt(0) > 0xff ? 2 : 1),
    0,
  );
}

function truncate(value, width) {
  let result = '';
  for (const character of String(value)) {
    if (displayWidth(`${result}${character}`) > width - 1) {
      return `${result}…`;
    }
    result += character;
  }
  return result;
}

function padCell(value, width) {
  return `${value}${' '.repeat(Math.max(0, width - displayWidth(value)))}`;
}

function yesNo(value) {
  return value ? '是' : '否';
}

function safeHumanText(value) {
  return String(value).replace(
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g,
    (character) =>
      `\\u${character.codePointAt(0).toString(16).padStart(4, '0')}`,
  );
}
