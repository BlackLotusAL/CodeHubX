import stringWidth from 'string-width';
import wrapAnsi from 'wrap-ansi';
import { errorResult, humanErrorMessage } from './errors.js';

const DEFAULT_COLUMNS = 100;
const MIN_COLUMNS = 40;
const MAX_COLUMNS = 240;
const ANSI_PATTERN = /[\u001B\u009B][[\]()#;?]*(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d\/#&.:=?%@~_]+)*)?\u0007|(?:(?:\d{1,4}(?:[;:]\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g;
const JSON_TERMINAL_CONTROL_PATTERN = /[\u007F-\u009F]/g;

export function createProcessIo({
  stdout = process.stdout,
  stderr = process.stderr,
  env = process.env,
} = {}) {
  return {
    stdout: (value) => stdout.write(value),
    stderr: (value) => stderr.write(value),
    stdoutIsTTY: Boolean(stdout.isTTY),
    stderrIsTTY: Boolean(stderr.isTTY),
    columns: stdout.columns ?? DEFAULT_COLUMNS,
    env,
  };
}

export function writeSuccess(io, format, command, data, options = {}) {
  if (format === 'json') {
    io.stdout(`${serialiseJson(data)}\n`);
    return;
  }
  io.stdout(`${renderHuman(command, data, { ...options, io })}\n`);
}

export function writeFailure(io, format, error) {
  if (format === 'json') {
    io.stderr(`${serialiseJson(errorResult(error))}\n`);
    return;
  }
  const colors = createColors(shouldUseColor(io.env, io.stderrIsTTY));
  io.stderr(`${colors.error(humanErrorMessage(error))}\n`);
}

export function renderHuman(command, data, { io, now = Date.now } = {}) {
  const columns = clamp(io?.columns ?? DEFAULT_COLUMNS, MIN_COLUMNS, MAX_COLUMNS);
  const colors = createColors(shouldUseColor(io?.env ?? {}, Boolean(io?.stdoutIsTTY)));
  const context = { columns, colors, now: typeof now === 'function' ? now() : now };

  switch (command) {
    case 'config.init':
      return data.created
        ? `已创建配置文件：${safeText(data.config_path)}`
        : `配置文件已存在，未覆盖：${safeText(data.config_path)}`;
    case 'auth.login':
      return `认证已配置\n${definitionList([
        ['认证方式', authTypeName(data.authentication_type)],
        ['API 地址', data.api_host],
      ], context)}`;
    case 'auth.status':
      return data.configured
        ? `已登录\n${definitionList([
            ['认证方式', authTypeName(data.authentication_type)],
            ['API 地址', data.api_host],
          ], context)}`
        : `未登录\n${definitionList([['API 地址', data.api_host]], context)}`;
    case 'auth.logout':
      return `本地认证凭据已清除\n${definitionList([['API 地址', data.api_host]], context)}`;
    case 'repo.list':
      return renderRepoList(data, context);
    case 'repo.view':
      return renderRepoView(data, context);
    case 'mr.list':
      return renderMrList(data, context);
    case 'mr.view':
      return renderMrView(data, context);
    case 'mr.commits':
      return renderCommitList(data, context);
    case 'mr.comment.create':
      return `评论已创建\n${definitionList([
        ['评论 ID', data.comment_id],
        ['Project', data.repo_id],
        ['MR IID', data.mr_iid],
        ['严重级别', data.severity],
        ['已解决', yesNo(data.resolved)],
        ['Web', data.web_url],
      ], context)}`;
    default:
      return safeText(JSON.stringify(data));
  }
}

function renderRepoList(repositories, context) {
  if (repositories.length === 0) return '没有仓库。';
  const idWidth = clamp(Math.max(2, ...repositories.map((row) => stringWidth(printable(row.repo_id)))), 2, 16);
  const timeWidth = 12;
  const nameWidth = Math.max(12, context.columns - idWidth - timeWidth - 4);
  const header = `${pad('ID', idWidth)}  ${pad('仓库', nameWidth)}  更新时间`;
  const lines = [context.colors.header(header)];

  for (const row of repositories) {
    lines.push(
      `${pad(truncate(row.repo_id, idWidth), idWidth)}  ${pad(truncate(row.full_name, nameWidth), nameWidth)}  ${relativeTime(row.updated_at, context.now)}`,
    );
    const labelWidth = idWidth + 2;
    for (const [label, value] of [['SSH', row.clone_urls?.ssh], ['HTTPS', row.clone_urls?.https]]) {
      if (value === null) continue;
      const prefix = `${' '.repeat(labelWidth)}${pad(label, 7)} `;
      lines.push(...wrapWithIndent(value, context.columns, prefix, ' '.repeat(stringWidth(prefix))));
    }
  }
  return lines.join('\n');
}

function renderRepoView(repository, context) {
  return definitionList([
    ['Project ID', repository.repo_id],
    ['仓库', repository.full_name],
    ['默认分支', repository.default_branch],
    ['已归档', yesNo(repository.archived)],
    ['更新时间', detailTime(repository.updated_at)],
    ['SSH', repository.clone_urls?.ssh],
    ['HTTPS', repository.clone_urls?.https],
    ['Web', repository.web_url],
  ], context);
}

function renderMrList(mergeRequests, context) {
  if (mergeRequests.length === 0) return '没有 Merge Request。';
  const iidWidth = clamp(Math.max(3, ...mergeRequests.map((row) => stringWidth(printable(row.iid)))), 3, 12);
  const stateWidth = 8;
  const authorWidth = 12;
  const timeWidth = 12;
  const titleWidth = Math.max(12, context.columns - iidWidth - stateWidth - authorWidth - timeWidth - 8);
  const header = [pad('IID', iidWidth), pad('状态', stateWidth), pad('标题', titleWidth), pad('作者', authorWidth), '更新时间'].join('  ');
  const lines = [context.colors.header(header)];

  for (const row of mergeRequests) {
    const state = printable(row.state);
    const cells = [
      pad(truncate(row.iid, iidWidth), iidWidth),
      pad(context.colors.state(state, row.state), stateWidth),
      pad(truncate(row.title, titleWidth), titleWidth),
      pad(truncate(authorName(row.author), authorWidth), authorWidth),
      relativeTime(row.updated_at, context.now),
    ];
    lines.push(cells.join('  '));
    const branch = `${printable(row.source_branch)} → ${printable(row.target_branch)}`;
    lines.push(...wrapWithIndent(branch, context.columns, ' '.repeat(iidWidth + 2), ' '.repeat(iidWidth + 2)));
  }
  return lines.join('\n');
}

function renderMrView(mr, context) {
  return definitionList([
    ['Project ID', mr.repo_id],
    ['MR ID', mr.mr_id],
    ['IID', mr.iid],
    ['标题', mr.title],
    ['状态', mr.state],
    ['草稿', yesNo(mr.is_draft)],
    ['作者', authorName(mr.author)],
    ['分支', `${printable(mr.source_branch)} → ${printable(mr.target_branch)}`],
    ['标签', mr.labels?.join(', ') ?? null],
    ['创建时间', detailTime(mr.created_at)],
    ['更新时间', detailTime(mr.updated_at)],
    ['变更', changesText(mr.changes)],
    ['描述', mr.description],
    ['Web', mr.web_url],
  ], context);
}

function renderCommitList(commits, context) {
  if (commits.length === 0) return '没有 Commit。';
  const lines = [];
  for (const commit of commits) {
    const sha = printable(commit.sha);
    lines.push(context.colors.header(`${sha.slice(0, 12)} ${printable(commit.title)}`));
    const details = [
      `作者 ${personName(commit.author)}`,
      `提交 ${personName(commit.committer)}`,
      detailTime(commit.committed_at),
    ].join(' · ');
    lines.push(...wrapWithIndent(details, context.columns, '  ', '  '));
    const parents = commit.parent_shas?.length ? commit.parent_shas.join(', ') : '-';
    lines.push(...wrapWithIndent(`父 SHA ${parents}`, context.columns, '  ', '    '));
    if (commit.message && commit.message !== commit.title) {
      lines.push(...wrapWithIndent(commit.message, context.columns, '  ', '  '));
    }
  }
  return lines.join('\n');
}

function definitionList(entries, context) {
  const valid = entries.map(([label, value]) => [label, printable(value)]);
  const labelWidth = Math.max(...valid.map(([label]) => stringWidth(label)));
  const lines = [];
  for (const [label, value] of valid) {
    const first = `${pad(label, labelWidth)}  `;
    const next = ' '.repeat(stringWidth(first));
    lines.push(...wrapWithIndent(value, context.columns, first, next));
  }
  return lines.join('\n');
}

function wrapWithIndent(value, columns, firstIndent = '', nextIndent = firstIndent) {
  const safe = safeText(value);
  const width = Math.max(1, columns - stringWidth(nextIndent));
  const wrapped = wrapAnsi(safe, width, { hard: true, trim: false }).split('\n');
  return wrapped.map((line, index) => `${index === 0 ? firstIndent : nextIndent}${line}`);
}

function truncate(value, width) {
  const text = safeText(printable(value));
  if (stringWidth(text) <= width) return text;
  if (width <= 1) return '…'.slice(0, width);
  let result = '';
  for (const character of text) {
    if (stringWidth(`${result}${character}…`) > width) break;
    result += character;
  }
  return `${result}…`;
}

function pad(value, width) {
  const text = String(value);
  return `${text}${' '.repeat(Math.max(0, width - stringWidth(text)))}`;
}

function relativeTime(value, now) {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return '-';
  const difference = Math.max(0, now - timestamp);
  if (difference < 60_000) return '刚刚';
  if (difference < 3_600_000) return `${Math.floor(difference / 60_000)} 分钟前`;
  if (difference < 86_400_000) return `${Math.floor(difference / 3_600_000)} 小时前`;
  if (difference <= 30 * 86_400_000) return `${Math.floor(difference / 86_400_000)} 天前`;
  return new Date(timestamp).toISOString().slice(0, 10);
}

function detailTime(value) {
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? '-' : new Date(timestamp).toISOString();
}

function shouldUseColor(env, isTTY) {
  if (env?.CLICOLOR_FORCE && env.CLICOLOR_FORCE !== '0') return true;
  if (
    Object.hasOwn(env ?? {}, 'NO_COLOR') ||
    env?.CLICOLOR === '0' ||
    env?.TERM === 'dumb'
  ) return false;
  return isTTY;
}

function createColors(enabled) {
  const color = (code, value) => enabled ? `\u001B[${code}m${value}\u001B[0m` : value;
  return {
    header: (value) => color('1', value),
    error: (value) => color('31', value),
    state: (value, state) => {
      if (state === 'opened' || state === 'open') return color('32', value);
      if (state === 'merged') return color('35', value);
      if (state === 'closed') return color('31', value);
      return value;
    },
  };
}

function serialiseJson(value) {
  return JSON.stringify(value, null, 2).replace(
    JSON_TERMINAL_CONTROL_PATTERN,
    (character) => `\\u${character.codePointAt(0).toString(16).padStart(4, '0')}`,
  );
}

function safeText(value) {
  return String(value ?? '')
    .replace(ANSI_PATTERN, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '�');
}

function printable(value) {
  return value === null || value === undefined || value === '' ? '-' : safeText(value);
}

function authorName(author) {
  return author?.name ?? author?.username ?? '-';
}

function personName(person) {
  if (!person) return '-';
  return person.email ? `${printable(person.name)} <${printable(person.email)}>` : printable(person.name);
}

function authTypeName(value) {
  return value === 'private_token' ? 'Private Token' : value === 'devuc' ? 'DevUC' : '-';
}

function yesNo(value) {
  return value === true ? '是' : value === false ? '否' : '-';
}

function changesText(changes) {
  if (!changes) return '-';
  return `${printable(changes.files)} 个文件，+${printable(changes.additions)} / -${printable(changes.deletions)}`;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}
