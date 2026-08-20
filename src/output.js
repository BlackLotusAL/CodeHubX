import stringWidth from 'string-width';
import wrapAnsi from 'wrap-ansi';
import { SUCCESS_ICON } from './constants.js';
import { errorResult } from './errors.js';

const DEFAULT_COLUMNS = 100;
const MIN_COLUMNS = 40;
const MAX_COLUMNS = 240;
const ACTIVITY_DELAY_MS = 300;
const ACTIVITY_INTERVAL_MS = 80;
const SPINNER_FRAMES = Object.freeze(['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']);
const ACTIVITY_MESSAGES = Object.freeze({
  'repo.list': '正在获取仓库列表…',
  'repo.view': '正在获取仓库详情…',
  'mr.list': '正在获取 Merge Request 列表…',
  'mr.view': '正在获取 Merge Request 详情…',
  'mr.commits': '正在获取 Commit 列表…',
  'mr.comment.create': '正在创建评论…',
});
const ANSI_PATTERN =
  /[\u001B\u009B][[\]()#;?]*(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d/#&.:=?%@~_]+)*)?\u0007|(?:(?:\d{1,4}(?:[;:]\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g;
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
  const theme = createTheme(shouldUseColor(io.env, io.stderrIsTTY));
  io.stderr(`${renderHumanError(error, theme)}\n`);
}

export function createActivity({
  io,
  format,
  command,
  delayMs = ACTIVITY_DELAY_MS,
  intervalMs = ACTIVITY_INTERVAL_MS,
  timers = globalThis,
} = {}) {
  const message = ACTIVITY_MESSAGES[command];
  const enabled = Boolean(message && format === 'human' && io?.stdoutIsTTY && io?.stderrIsTTY);
  const theme = createTheme(shouldUseColor(io?.env ?? {}, Boolean(io?.stderrIsTTY)));
  let delayTimer = null;
  let frameTimer = null;
  let frameIndex = 0;
  let shown = false;
  let renderedWidth = 0;
  let active = false;

  const renderFrame = () => {
    const frame = theme.accent(SPINNER_FRAMES[frameIndex % SPINNER_FRAMES.length]);
    frameIndex += 1;
    const line = `${frame} ${message}`;
    renderedWidth = Math.max(renderedWidth, stringWidth(line));
    shown = true;
    io.stderr(`\r${line}`);
  };

  const start = () => {
    if (!enabled || active) return;
    active = true;
    delayTimer = timers.setTimeout(() => {
      delayTimer = null;
      if (!active) return;
      renderFrame();
      frameTimer = timers.setInterval(renderFrame, intervalMs);
      frameTimer?.unref?.();
    }, delayMs);
    delayTimer?.unref?.();
  };

  const stop = () => {
    if (!active) return;
    active = false;
    if (delayTimer !== null) timers.clearTimeout(delayTimer);
    if (frameTimer !== null) timers.clearInterval(frameTimer);
    delayTimer = null;
    frameTimer = null;
    if (shown) io.stderr(`\r${' '.repeat(renderedWidth)}\r`);
    shown = false;
    renderedWidth = 0;
  };

  return {
    enabled,
    start,
    stop,
    async run(callback) {
      start();
      try {
        return await callback();
      } finally {
        stop();
      }
    },
  };
}

export function renderHuman(command, data, { io, now = Date.now } = {}) {
  const columns = clamp(io?.columns ?? DEFAULT_COLUMNS, MIN_COLUMNS, MAX_COLUMNS);
  const theme = createTheme(shouldUseColor(io?.env ?? {}, Boolean(io?.stdoutIsTTY)));
  const context = { columns, theme, now: typeof now === 'function' ? now() : now };

  switch (command) {
    case 'config.init':
      return renderConfigInit(data, context);
    case 'auth.login':
      return statusCard(
        'success',
        '认证已配置',
        [
          ['认证方式', styledValue(authTypeName(data.authentication_type), theme.accent, context)],
          ['API 地址', linkValue(data.api_host, context)],
        ],
        context,
      );
    case 'auth.status':
      return data.configured
        ? statusCard(
            'success',
            '已登录',
            [
              [
                '认证方式',
                styledValue(authTypeName(data.authentication_type), theme.accent, context),
              ],
              ['API 地址', linkValue(data.api_host, context)],
            ],
            context,
          )
        : statusCard(
            'neutral',
            '未登录',
            [['API 地址', linkValue(data.api_host, context)]],
            context,
          );
    case 'auth.logout':
      return statusCard(
        'success',
        '本地认证凭据已清除',
        [['API 地址', linkValue(data.api_host, context)]],
        context,
      );
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
      return renderCommentResult(data, context);
    default:
      return safeText(JSON.stringify(data));
  }
}

function renderConfigInit(data, context) {
  return data.created
    ? statusCard(
        'success',
        '已创建配置文件',
        [['路径', styledValue(data.config_path, context.theme.accent, context)]],
        context,
      )
    : statusCard(
        'warning',
        '配置文件已存在，未覆盖',
        [['路径', styledValue(data.config_path, context.theme.accent, context)]],
        context,
      );
}

function renderRepoList(repositories, context) {
  if (repositories.length === 0) return emptyState('没有仓库。', context);
  const cards = repositories.map((repository) => renderRepoCard(repository, context));
  return `${countSummary(repositories.length, '个仓库', context)}\n\n${cards.join('\n\n')}`;
}

function renderRepoCard(repository, context) {
  const status = repoStatus(repository.archived, context);
  const prefix = `${status.icon} ${styledValue(repository.repo_id, context.theme.accent, context)}  `;
  const lines = wrapRendered(
    styledValue(repository.full_name, context.theme.title, context),
    context.columns,
    prefix,
    ' '.repeat(stringWidth(prefix)),
  );
  lines.push(
    ...wrapRendered(
      `${status.text}${separator(context)}${context.theme.muted(`更新 ${relativeTime(repository.updated_at, context.now)}`)}`,
      context.columns,
      '  ',
      '  ',
    ),
  );
  lines.push(
    ...urlRows(
      [
        ['SSH', repository.clone_urls?.ssh],
        ['HTTPS', repository.clone_urls?.https],
      ],
      context,
      { skipMissing: true },
    ),
  );
  return lines.join('\n');
}

function renderRepoView(repository, context) {
  const status = repoStatus(repository.archived, context);
  const prefix = `${status.icon} ${context.theme.muted('Project')} ${styledValue(repository.repo_id, context.theme.accent, context)}  `;
  const lines = wrapRendered(
    styledValue(repository.full_name, context.theme.title, context),
    context.columns,
    prefix,
    ' '.repeat(stringWidth(prefix)),
  );
  lines.push(
    ...wrapRendered(
      [
        status.text,
        `${context.theme.muted('默认分支')} ${styledValue(repository.default_branch, context.theme.accent, context)}`,
      ].join(separator(context)),
      context.columns,
      '  ',
      '  ',
    ),
  );
  lines.push(
    ...wrapRendered(
      `${context.theme.muted('更新')} ${context.theme.muted(detailTime(repository.updated_at))}`,
      context.columns,
      '  ',
      '  ',
    ),
  );
  lines.push(
    ...urlRows(
      [
        ['SSH', repository.clone_urls?.ssh],
        ['HTTPS', repository.clone_urls?.https],
        ['Web', repository.web_url],
      ],
      context,
    ),
  );
  return lines.join('\n');
}

function renderMrList(mergeRequests, context) {
  if (mergeRequests.length === 0) return emptyState('没有 Merge Request。', context);
  const cards = mergeRequests.map((mr) => renderMrCard(mr, context));
  return `${countSummary(mergeRequests.length, '个 Merge Request', context)}\n\n${cards.join('\n\n')}`;
}

function renderMrCard(mr, context) {
  const status = mrStatus(mr.state, context);
  const prefix = `${status.icon} ${styledValue(mrIidText(mr.iid), context.theme.accent, context, true)}  `;
  const lines = wrapRendered(
    styledValue(mr.title, context.theme.title, context),
    context.columns,
    prefix,
    ' '.repeat(stringWidth(prefix)),
  );
  const metadata = [status.text];
  if (mr.is_draft === true) metadata.push(context.theme.warning('draft'));
  metadata.push(styledValue(authorName(mr.author), context.theme.plain, context));
  metadata.push(context.theme.muted(relativeTime(mr.updated_at, context.now)));
  lines.push(...wrapRendered(metadata.join(separator(context)), context.columns, '  ', '  '));
  lines.push(
    ...wrapRendered(
      branchText(mr.source_branch, mr.target_branch, context),
      context.columns,
      '  ',
      '  ',
    ),
  );
  return lines.join('\n');
}

function renderMrView(mr, context) {
  const status = mrStatus(mr.state, context);
  const prefix = `${status.icon} ${styledValue(mrIidText(mr.iid), context.theme.accent, context, true)}  `;
  const lines = wrapRendered(
    styledValue(mr.title, context.theme.title, context),
    context.columns,
    prefix,
    ' '.repeat(stringWidth(prefix)),
  );
  lines.push(
    ...wrapRendered(
      [
        `${context.theme.muted('Project')} ${styledValue(mr.repo_id, context.theme.accent, context)}`,
        `${context.theme.muted('MR')} ${styledValue(mr.mr_id, context.theme.accent, context)}`,
        `${context.theme.muted('作者')} ${styledValue(authorName(mr.author), context.theme.plain, context)}`,
      ].join(separator(context)),
      context.columns,
      '  ',
      '  ',
    ),
  );
  lines.push(
    ...wrapRendered(
      [`${context.theme.muted('状态')} ${status.text}`, draftText(mr.is_draft, context)].join(
        separator(context),
      ),
      context.columns,
      '  ',
      '  ',
    ),
  );
  lines.push(
    ...wrapRendered(
      `${context.theme.muted('分支')} ${branchText(mr.source_branch, mr.target_branch, context)}`,
      context.columns,
      '  ',
      '  ',
    ),
  );
  lines.push(
    ...wrapRendered(
      `${context.theme.muted('创建')} ${context.theme.muted(detailTime(mr.created_at))}`,
      context.columns,
      '  ',
      '  ',
    ),
  );
  lines.push(
    ...wrapRendered(
      `${context.theme.muted('更新')} ${context.theme.muted(detailTime(mr.updated_at))}`,
      context.columns,
      '  ',
      '  ',
    ),
  );
  lines.push(...wrapRendered(labelText(mr.labels, context), context.columns, '  ', '  '));

  lines.push('', context.theme.title('变更'));
  lines.push(...wrapRendered(changesText(mr.changes, context), context.columns, '  ', '  '));
  lines.push('', context.theme.title('描述'));
  lines.push(
    ...wrapRendered(
      styledValue(mr.description, context.theme.plain, context),
      context.columns,
      '  ',
      '  ',
    ),
  );
  lines.push('', ...urlRows([['Web', mr.web_url]], context));
  return lines.join('\n');
}

function renderCommitList(commits, context) {
  if (commits.length === 0) return emptyState('没有 Commit。', context);
  const cards = commits.map((commit) => renderCommitCard(commit, context));
  return `${countSummary(commits.length, '个 Commit', context)}\n\n${cards.join('\n\n')}`;
}

function renderCommitCard(commit, context) {
  const sha = inlinePrintable(commit.sha);
  const shortSha = sha === '-' ? sha : sha.slice(0, 12);
  const prefix = `${context.theme.neutral('●')} ${styledValue(shortSha, context.theme.accent, context, true)}  `;
  const lines = wrapRendered(
    styledValue(commit.title, context.theme.title, context),
    context.columns,
    prefix,
    ' '.repeat(stringWidth(prefix)),
  );
  lines.push(
    ...wrapRendered(
      [
        `${context.theme.muted('作者')} ${styledValue(personName(commit.author), context.theme.plain, context)}`,
        `${context.theme.muted('提交者')} ${styledValue(personName(commit.committer), context.theme.plain, context)}`,
        context.theme.muted(detailTime(commit.committed_at)),
      ].join(separator(context)),
      context.columns,
      '  ',
      '  ',
    ),
  );
  const parents = commit.parent_shas?.length ? commit.parent_shas.join(', ') : null;
  lines.push(
    ...wrapRendered(
      `${context.theme.muted('父 SHA')} ${styledValue(parents, context.theme.accent, context)}`,
      context.columns,
      '  ',
      '    ',
    ),
  );
  if (commit.message && commit.message !== commit.title) {
    lines.push(
      ...wrapRendered(
        styledValue(commit.message, context.theme.plain, context),
        context.columns,
        `${context.theme.muted('  消息')}  `,
        '        ',
      ),
    );
  }
  return lines.join('\n');
}

function renderCommentResult(data, context) {
  return statusCard(
    'success',
    '评论已创建',
    [
      ['评论', styledValue(data.comment_id, context.theme.accent, context)],
      ['Project', styledValue(data.repo_id, context.theme.accent, context)],
      ['MR', styledValue(mrIidText(data.mr_iid), context.theme.accent, context, true)],
      ['严重级别', severityText(data.severity, context)],
      ['已解决', booleanText(data.resolved, context)],
      ['Web', linkValue(data.web_url, context)],
    ],
    context,
  );
}

function statusCard(kind, title, entries, context) {
  const status = statusPresentation(kind, context);
  return [
    `${status.icon} ${context.theme.title(safeText(title))}`,
    ...detailRows(entries, context),
  ].join('\n');
}

function detailRows(entries, context) {
  const labelWidth = Math.max(...entries.map(([label]) => stringWidth(label)));
  const lines = [];
  for (const [label, renderedValue] of entries) {
    const prefix = `  ${context.theme.muted(pad(safeText(label), labelWidth))}  `;
    lines.push(
      ...wrapRendered(renderedValue, context.columns, prefix, ' '.repeat(stringWidth(prefix))),
    );
  }
  return lines;
}

function urlRows(entries, context, { skipMissing = false } = {}) {
  const rows = skipMissing
    ? entries.filter(([, value]) => value !== null && value !== undefined && value !== '')
    : entries;
  if (rows.length === 0) return [];
  const labelWidth = Math.max(...rows.map(([label]) => stringWidth(label)));
  const lines = [];
  for (const [label, value] of rows) {
    const prefix = `  ${context.theme.muted(pad(label, labelWidth))}  `;
    lines.push(
      ...wrapRendered(
        linkValue(value, context),
        context.columns,
        prefix,
        ' '.repeat(stringWidth(prefix)),
      ),
    );
  }
  return lines;
}

function countSummary(count, noun, context) {
  return `${context.theme.muted('共')} ${context.theme.accent(String(count))} ${context.theme.muted(noun)}`;
}

function emptyState(message, context) {
  return context.theme.muted(`○ ${safeText(message)}`);
}

function repoStatus(archived, context) {
  if (archived === true) {
    return { icon: context.theme.warning('!'), text: context.theme.warning('archived') };
  }
  if (archived === false) {
    return { icon: context.theme.success('●'), text: context.theme.success('active') };
  }
  return { icon: context.theme.neutral('○'), text: context.theme.muted('状态未知') };
}

function mrStatus(state, context) {
  const printableState = inlinePrintable(state);
  if (state === 'opened' || state === 'open') {
    return { icon: context.theme.success('●'), text: context.theme.success(printableState) };
  }
  if (state === 'merged') {
    return { icon: context.theme.merged(SUCCESS_ICON), text: context.theme.merged(printableState) };
  }
  if (state === 'closed') {
    return { icon: context.theme.error('✗'), text: context.theme.error(printableState) };
  }
  if (state === 'locked') {
    return { icon: context.theme.warning('!'), text: context.theme.warning(printableState) };
  }
  return {
    icon: context.theme.neutral('○'),
    text: styledValue(state, context.theme.muted, context),
  };
}

function statusPresentation(kind, context) {
  if (kind === 'success') return { icon: context.theme.success(SUCCESS_ICON) };
  if (kind === 'warning') return { icon: context.theme.warning('!') };
  return { icon: context.theme.neutral('○') };
}

function renderHumanError(error, theme) {
  const message = safeText(error.humanMessage ?? 'CodeHub 请求失败。');
  const code = `[${safeText(error.code ?? 'HTTP_ERROR')}]`;
  const status =
    error.httpStatus === null || error.httpStatus === undefined
      ? ''
      : theme.muted(`（HTTP ${safeText(error.httpStatus)}）`);
  if (error.code === 'WRITE_RESULT_UNKNOWN') {
    return `${theme.warning('!')} ${theme.warningBold(code)} ${message}${status}`;
  }
  if (error.code === 'CANCELLED') {
    return `${theme.neutral('○')} ${theme.muted(code)} ${message}${status}`;
  }
  return `${theme.error('✗')} ${theme.errorBold(code)} ${message}${status}`;
}

function styledValue(value, style, context, alreadySafe = false) {
  const text = alreadySafe ? String(value) : printable(value);
  return text === '-' ? context.theme.muted(text) : style(text);
}

function linkValue(value, context) {
  const text = printable(value);
  return text === '-' ? context.theme.muted(text) : context.theme.link(text);
}

function branchText(source, target, context) {
  return `${styledValue(source, context.theme.accent, context)} ${context.theme.muted('→')} ${styledValue(target, context.theme.accent, context)}`;
}

function draftText(value, context) {
  if (value === true) return `${context.theme.muted('草稿')} ${context.theme.warning('是')}`;
  if (value === false) return `${context.theme.muted('草稿')} ${context.theme.success('否')}`;
  return `${context.theme.muted('草稿')} ${context.theme.muted('-')}`;
}

function booleanText(value, context) {
  if (value === true) return context.theme.success('是');
  if (value === false) return context.theme.warning('否');
  return context.theme.muted('-');
}

function severityText(value, context) {
  const text = printable(value);
  if (value === 'suggestion') return context.theme.accent(text);
  if (value === 'minor') return context.theme.warning(text);
  if (value === 'major') return context.theme.merged(text);
  if (value === 'fatal') return context.theme.error(text);
  return context.theme.muted(text);
}

function labelText(labels, context) {
  const prefix = context.theme.muted('标签');
  if (!labels?.length) return `${prefix} ${context.theme.muted('-')}`;
  return `${prefix} ${labels.map((label) => context.theme.merged(`[${inlinePrintable(label)}]`)).join(' ')}`;
}

function changesText(changes, context) {
  if (!changes) return context.theme.muted('-');
  const files =
    changes.files === null || changes.files === undefined
      ? context.theme.muted('- 个文件')
      : `${styledValue(changes.files, context.theme.accent, context)} ${context.theme.muted('个文件')}`;
  const additions =
    changes.additions === null || changes.additions === undefined
      ? context.theme.muted('+-')
      : context.theme.success(`+${inlinePrintable(changes.additions)}`);
  const deletions =
    changes.deletions === null || changes.deletions === undefined
      ? context.theme.muted('--')
      : context.theme.error(`-${inlinePrintable(changes.deletions)}`);
  return [files, additions, deletions].join(separator(context));
}

function separator(context) {
  return context.theme.muted(' · ');
}

function wrapRendered(value, columns, firstIndent = '', nextIndent = firstIndent) {
  const width = Math.max(1, columns - stringWidth(nextIndent));
  const wrapped = wrapAnsi(String(value), width, { hard: true, trim: false }).split('\n');
  return wrapped.map((line, index) => `${index === 0 ? firstIndent : nextIndent}${line}`);
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
  if (Object.hasOwn(env ?? {}, 'NO_COLOR') || env?.CLICOLOR === '0' || env?.TERM === 'dumb')
    return false;
  return isTTY;
}

function createTheme(enabled) {
  const style =
    (...codes) =>
    (value) =>
      enabled ? `\u001B[${codes.join(';')}m${value}\u001B[0m` : String(value);
  return {
    enabled,
    plain: (value) => String(value),
    title: style('1'),
    muted: style('2'),
    accent: style('36'),
    link: style('36', '4'),
    success: style('32'),
    warning: style('33'),
    warningBold: style('1', '33'),
    merged: style('35'),
    error: style('31'),
    errorBold: style('1', '31'),
    neutral: style('2'),
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

function inlinePrintable(value) {
  return printable(value).replace(/[\t\r\n]+/g, ' ');
}

function mrIidText(value) {
  const text = inlinePrintable(value);
  return text === '-' ? text : `!${text}`;
}

function authorName(author) {
  return author?.name ?? author?.username ?? '-';
}

function personName(person) {
  if (!person) return '-';
  return person.email
    ? `${printable(person.name)} <${printable(person.email)}>`
    : printable(person.name);
}

function authTypeName(value) {
  return value === 'private_token' ? 'Private Token' : value === 'devuc' ? 'DevUC' : '-';
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}
