import stringWidth from 'string-width';
import wrapAnsi from 'wrap-ansi';
import { SCHEMA_VERSION } from './constants.js';

const DEFAULT_COLUMNS = 100;
const MIN_COLUMNS = 20;
const MAX_COLUMNS = 240;

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

export function writeSuccess(io, format, envelope, options = {}) {
  if (format === 'json') {
    io.stdout(`${JSON.stringify(envelope, null, 2)}\n`);
    return;
  }

  io.stdout(`${renderHuman(envelope.command, envelope.data, envelope.warnings, options)}\n`);
}

export function writeError(io, format, envelope, options = {}) {
  if (format === 'json') {
    io.stderr(`${JSON.stringify(envelope, null, 2)}\n`);
    return;
  }

  const context = renderContext(options, options.stderrIsTTY);
  const status = envelope.error.http_status
    ? ` (HTTP ${envelope.error.http_status})`
    : '';
  const heading = context.color.red(`错误 [${safeHumanText(envelope.error.code)}]`);
  io.stderr(
    `${heading}${status}: ${safeHumanText(envelope.error.message)}\n`,
  );
}

export function renderHuman(command, data, warnings = [], options = {}) {
  const context = renderContext(options, options.stdoutIsTTY ?? options.isTTY);
  const sections = [];

  switch (command) {
    case 'version':
      sections.push(
        renderDefinitionList(
          [
            ['CodeHub CLI', data.cli_version],
            ['机器协议', data.protocol_version],
            ['Node.js', data.node_version],
            ['平台', `${data.platform}/${data.arch}`],
          ],
          context,
        ),
      );
      break;
    case 'capabilities':
      sections.push(
        renderDefinitionList(
          [
            ['认证方式', data.authentication_methods.join(', ')],
            ['读取命令', data.read_commands.join(', ')],
            ['写入命令', data.write_commands.join(', ')],
            ['稳定分页', yesNo(data.pagination_guaranteed)],
            ['条件写', yesNo(data.conditional_write)],
            ['幂等写', yesNo(data.idempotent_write)],
            ['行级评论', yesNo(data.inline_discussion)],
            ['写入必须确认', yesNo(data.write_requires_confirmation)],
            ['写入自动重试', yesNo(data.write_auto_retry)],
          ],
          context,
        ),
      );
      break;
    case 'auth.login':
      sections.push(
        `${context.color.green('✓')} ${context.color.bold('登录成功')}\n${renderDefinitionList(
          [
            ['认证类型', data.authentication_type],
            ['凭据来源', data.credential_source],
            ['API', data.api_host],
          ],
          context,
        )}`,
      );
      break;
    case 'auth.status':
      sections.push(renderAuthStatus(data, context));
      break;
    case 'auth.logout':
      sections.push(
        `${context.color.green('✓')} Credential Helper 中的 CodeHub 凭据已删除。`,
      );
      break;
    case 'repo.list':
      sections.push(renderRepoList(data, context));
      break;
    case 'repo.view':
      sections.push(renderRepoView(data, context));
      break;
    case 'mr.list':
      sections.push(renderMergeRequestList(data, context));
      break;
    case 'mr.view':
      sections.push(renderMergeRequestView(data, context));
      break;
    case 'mr.commits':
      sections.push(renderCommitList(data, context));
      break;
    case 'mr.comment.create':
      sections.push(renderCommentResult(data, context));
      break;
    default:
      sections.push(JSON.stringify(data, null, 2));
  }

  if (warnings.length > 0) {
    sections.push(renderWarnings(warnings, context));
  }

  return sections.filter(Boolean).join('\n\n');
}

function renderAuthStatus(data, context) {
  const status = data.configured
    ? `${context.color.green('✓')} ${context.color.bold('已登录')}`
    : `${context.color.yellow('!')} ${context.color.bold('未登录')}`;
  return `${status}\n${renderDefinitionList(
    [
      ['凭据来源', data.credential_source],
      ['认证类型', data.authentication_type],
      ['API', data.api_host],
    ],
    context,
  )}`;
}

function renderRepoList(repositories, context) {
  if (!Array.isArray(repositories) || repositories.length === 0) {
    return '没有结果。';
  }

  return repositories
    .map((repository) => {
      const id = repository.repo_id
        ? context.color.cyan(printable(repository.repo_id))
        : null;
      const name = context.color.bold(
        printable(repository.full_name ?? '未命名仓库'),
      );
      const updated = repository.updated_at
        ? context.color.dim(relativeTime(repository.updated_at, context.now))
        : null;
      const archived = repository.archived
        ? context.color.yellow('已归档')
        : null;
      const firstLine = [id, name, updated, archived].filter(Boolean).join('  ');
      const cloneLine = [
        repository.clone_urls?.ssh
          ? `${context.color.dim('SSH')} ${printable(repository.clone_urls.ssh)}`
          : null,
        repository.clone_urls?.https
          ? `${context.color.dim('HTTPS')} ${printable(repository.clone_urls.https)}`
          : null,
      ]
        .filter(Boolean)
        .join('   ');

      return [
        wrapWithIndent(firstLine, context.columns),
        cloneLine
          ? wrapWithIndent(cloneLine, context.columns, '  ', '    ')
          : null,
      ]
        .filter(Boolean)
        .join('\n');
    })
    .join('\n\n');
}

function renderRepoView(repository, context) {
  const title = context.color.bold(
    printable(repository.full_name ?? '未命名仓库'),
  );
  const archived = repository.archived
    ? ` ${context.color.yellow('已归档')}`
    : '';
  const metadata = renderDefinitionList(
    [
      ['仓库 ID', repository.repo_id],
      ['默认分支', repository.default_branch],
      ['更新时间', detailTime(repository.updated_at)],
      ['Web', repository.web_url],
    ],
    context,
  );
  const cloneUrls = renderDefinitionList(
    [
      ['SSH', repository.clone_urls?.ssh],
      ['HTTPS', repository.clone_urls?.https],
    ],
    context,
  );

  return [
    wrapWithIndent(`${title}${archived}`, context.columns),
    metadata,
    cloneUrls ? `${context.color.bold('Clone')}\n${cloneUrls}` : null,
  ]
    .filter(Boolean)
    .join('\n\n');
}

function renderMergeRequestList(mergeRequests, context) {
  if (!Array.isArray(mergeRequests) || mergeRequests.length === 0) {
    return '没有结果。';
  }

  if (context.columns < 76) {
    return mergeRequests
      .map((mergeRequest) => renderMergeRequestCard(mergeRequest, context))
      .join('\n\n');
  }

  const separatorWidth = 8;
  const mrWidth = 13;
  const authorWidth = clamp(Math.floor(context.columns * 0.14), 12, 18);
  const branchWidth = clamp(Math.floor(context.columns * 0.24), 18, 30);
  const updatedWidth = 12;
  const titleWidth =
    context.columns -
    separatorWidth -
    mrWidth -
    authorWidth -
    branchWidth -
    updatedWidth;

  if (titleWidth < 14) {
    return mergeRequests
      .map((mergeRequest) => renderMergeRequestCard(mergeRequest, context))
      .join('\n\n');
  }

  const widths = [mrWidth, titleWidth, authorWidth, branchWidth, updatedWidth];
  const header = ['MR', 'TITLE', 'AUTHOR', 'BRANCH', 'UPDATED']
    .map((value, index) => context.color.dim(padCell(value, widths[index])))
    .join('  ');
  const rows = mergeRequests.map((mergeRequest) => {
    const state = statePresentation(mergeRequest, context);
    const cells = [
      state.paint(
        padCell(
          truncateText(
            `#${printable(mergeRequest.iid)} ${state.label}`,
            mrWidth,
          ),
          mrWidth,
        ),
      ),
      context.color.bold(
        padCell(
          truncateText(
            printable(mergeRequest.title ?? '未命名'),
            titleWidth,
          ),
          titleWidth,
        ),
      ),
      padCell(
        truncateText(authorName(mergeRequest.author), authorWidth),
        authorWidth,
      ),
      padCell(
        branchCell(mergeRequest, branchWidth),
        branchWidth,
      ),
      padCell(
        truncateText(
          mergeRequest.updated_at
            ? relativeTime(mergeRequest.updated_at, context.now)
            : '',
          updatedWidth,
        ),
        updatedWidth,
      ),
    ];
    return cells.join('  ');
  });

  return [header, ...rows].join('\n');
}

function renderMergeRequestCard(mergeRequest, context) {
  const state = statePresentation(mergeRequest, context);
  const heading = `${state.paint(`#${printable(mergeRequest.iid)} ${state.label}`)} ${context.color.bold(
    mergeRequest.title ? printable(mergeRequest.title) : '未命名',
  )}`;
  const metadata = [
    nullableAuthorName(mergeRequest.author),
    branchNameOrNull(mergeRequest),
    mergeRequest.updated_at
      ? relativeTime(mergeRequest.updated_at, context.now)
      : null,
  ]
    .filter(Boolean)
    .join(' • ');
  return [
    wrapWithIndent(heading, context.columns),
    metadata
      ? wrapWithIndent(context.color.dim(metadata), context.columns, '  ', '  ')
      : null,
  ]
    .filter(Boolean)
    .join('\n');
}

function renderMergeRequestView(mergeRequest, context) {
  const state = statePresentation(mergeRequest, context);
  const heading = `${state.paint(state.label)} ${context.color.cyan(
    `#${printable(mergeRequest.iid)}`,
  )} ${context.color.bold(printable(mergeRequest.title ?? '未命名'))}`;
  const metadata = renderDefinitionList(
    [
      ['仓库 ID', mergeRequest.repo_id],
      ['MR ID', mergeRequest.mr_id],
      ['作者', nullableAuthorName(mergeRequest.author)],
      ['分支', branchNameOrNull(mergeRequest)],
      ['创建时间', detailTime(mergeRequest.created_at)],
      ['更新时间', detailTime(mergeRequest.updated_at)],
      ['Web', mergeRequest.web_url],
    ],
    context,
  );
  const description = mergeRequest.description !== null
    ? `${context.color.bold('描述')}\n${wrapMultiline(
        mergeRequest.description || '（空）',
        context.columns,
      )}`
    : null;
  const labels = Array.isArray(mergeRequest.labels)
    ? `${context.color.bold('标签')}\n${
        mergeRequest.labels.length > 0
          ? wrapWithIndent(
              mergeRequest.labels.map(printable).join(', '),
              context.columns,
            )
          : '（无）'
      }`
    : null;
  const changes = renderChanges(mergeRequest.changes, context);

  return [
    wrapWithIndent(heading, context.columns),
    metadata,
    description,
    labels,
    changes,
  ]
    .filter(Boolean)
    .join('\n\n');
}

function renderChanges(changes, context) {
  if (!changes || Object.values(changes).every((value) => value === null)) {
    return null;
  }

  const values = [
    changes.files === null ? null : `${changes.files} 个文件`,
    changes.additions === null
      ? null
      : context.color.green(`+${changes.additions}`),
    changes.deletions === null
      ? null
      : context.color.red(`-${changes.deletions}`),
  ].filter(Boolean);
  return `${context.color.bold('变更')}\n${values.join('  ')}`;
}

function renderCommitList(commits, context) {
  if (!Array.isArray(commits) || commits.length === 0) {
    return '没有结果。';
  }

  return commits
    .map((commit) => {
      const shortSha = commit.sha ? printable(commit.sha).slice(0, 8) : '-';
      const heading = `${context.color.cyan(shortSha)} ${context.color.bold(
        printable(commit.title ?? '无标题提交'),
      )}`;
      const metadata = renderDefinitionList(
        [
          ['作者', personName(commit.author)],
          ['提交者', personName(commit.committer)],
          [
            '作者时间',
            commit.authored_at
              ? relativeTime(commit.authored_at, context.now)
              : null,
          ],
          [
            '提交时间',
            commit.committed_at
              ? relativeTime(commit.committed_at, context.now)
              : null,
          ],
          [
            '父提交',
            Array.isArray(commit.parent_shas)
              ? commit.parent_shas.join(', ') || '（根提交）'
              : null,
          ],
        ],
        context,
      );
      const message =
        commit.message !== null && commit.message !== commit.title
          ? `${context.color.bold('消息')}\n${wrapMultiline(
              commit.message,
              context.columns,
              '  ',
            )}`
          : null;

      return [wrapWithIndent(heading, context.columns), metadata, message]
        .filter(Boolean)
        .join('\n');
    })
    .join('\n\n');
}

function renderCommentResult(data, context) {
  if (data.dry_run) {
    return `${context.color.green('✓')} ${context.color.bold(
      '评论请求校验通过',
    )} ${context.color.dim('（dry-run，未发送网络请求）')}\n${renderDefinitionList(
      [
        ['仓库 ID', data.repo_id],
        ['MR IID', data.mr_iid],
        ['严重级别', data.severity],
        ['正文 UTF-8 字节数', data.body_utf8_bytes],
        ['认证类型', data.authentication_type],
      ],
      context,
    )}`;
  }

  return `${context.color.green('✓')} ${context.color.bold(
    '评论创建成功',
  )}\n${renderDefinitionList(
    [
      ['评论 ID', data.comment_id],
      ['仓库 ID', data.repo_id],
      ['MR IID', data.mr_iid],
      ['严重级别', data.severity],
      ['已解决', data.resolved === null ? null : yesNo(data.resolved)],
      ['Web', data.web_url],
    ],
    context,
  )}`;
}

function renderWarnings(warnings, context) {
  const lines = warnings.map((warning) => {
    const prefix = context.color.yellow(`- [${safeHumanText(warning.code)}]`);
    return wrapWithIndent(
      `${prefix} ${safeHumanText(warning.message)}`,
      context.columns,
      '',
      '  ',
    );
  });
  return `${context.color.yellow('!')} ${context.color.bold('警告')}\n${lines.join('\n')}`;
}

function renderDefinitionList(entries, context) {
  const present = entries.filter(([, value]) => value !== null && value !== undefined);
  if (present.length === 0) {
    return '';
  }

  const labelWidth = Math.max(...present.map(([label]) => stringWidth(label)));
  return present
    .map(([label, value]) => {
      const paddedLabel = padCell(label, labelWidth);
      const prefix = `${context.color.dim(paddedLabel)}  `;
      return wrapWithIndent(
        printable(value),
        context.columns,
        prefix,
        ' '.repeat(labelWidth + 2),
      );
    })
    .join('\n');
}

function renderContext(options, isTTY) {
  const columns = clamp(
    Number.isFinite(Number(options.columns))
      ? Math.floor(Number(options.columns))
      : DEFAULT_COLUMNS,
    MIN_COLUMNS,
    MAX_COLUMNS,
  );
  const enabled = shouldUseColor(options.env ?? {}, Boolean(isTTY));
  const nowValue = typeof options.now === 'function' ? options.now() : options.now;
  const parsedNow = nowValue === undefined ? new Date() : new Date(nowValue);

  return {
    columns,
    now: Number.isNaN(parsedNow.valueOf()) ? new Date() : parsedNow,
    color: createColors(enabled),
  };
}

function shouldUseColor(env, isTTY) {
  if (env.CLICOLOR_FORCE && env.CLICOLOR_FORCE !== '0') {
    return true;
  }
  if (
    Object.hasOwn(env, 'NO_COLOR') ||
    env.CLICOLOR === '0' ||
    env.TERM === 'dumb'
  ) {
    return false;
  }
  return isTTY;
}

function createColors(enabled) {
  const paint = (open, close) => (value) =>
    enabled ? `\u001B[${open}m${value}\u001B[${close}m` : String(value);
  return {
    bold: paint(1, 22),
    dim: paint(2, 22),
    red: paint(31, 39),
    green: paint(32, 39),
    yellow: paint(33, 39),
    cyan: paint(36, 39),
    magenta: paint(35, 39),
  };
}

function statePresentation(mergeRequest, context) {
  if (mergeRequest.is_draft) {
    return { label: 'DRAFT', paint: context.color.yellow };
  }

  switch (mergeRequest.state) {
    case 'opened':
    case 'open':
      return { label: 'OPEN', paint: context.color.green };
    case 'merged':
      return { label: 'MERGED', paint: context.color.magenta };
    case 'closed':
      return { label: 'CLOSED', paint: context.color.red };
    case 'locked':
      return { label: 'LOCKED', paint: context.color.yellow };
    default:
      return {
        label: mergeRequest.state
          ? printable(mergeRequest.state).toUpperCase()
          : 'UNKNOWN',
        paint: context.color.dim,
      };
  }
}

function nullableAuthorName(author) {
  const value = author?.username ?? author?.name ?? author?.id;
  return value === null || value === undefined || value === ''
    ? null
    : printable(value);
}

function authorName(author) {
  return nullableAuthorName(author) ?? '';
}

function personName(person) {
  if (!person) {
    return null;
  }
  if (person.name && person.email) {
    return `${safeHumanText(person.name)} <${safeHumanText(person.email)}>`;
  }
  return person.name ?? person.email ?? null;
}

function branchName(mergeRequest) {
  return branchNameOrNull(mergeRequest) ?? '';
}

function branchNameOrNull(mergeRequest) {
  if (mergeRequest.source_branch === null && mergeRequest.target_branch === null) {
    return null;
  }
  const source = mergeRequest.source_branch
    ? printable(mergeRequest.source_branch)
    : '';
  const target = mergeRequest.target_branch
    ? printable(mergeRequest.target_branch)
    : '';
  return `${source} → ${target}`.trim();
}

function branchCell(mergeRequest, width) {
  const source = mergeRequest.source_branch
    ? printable(mergeRequest.source_branch)
    : '';
  const target = mergeRequest.target_branch
    ? printable(mergeRequest.target_branch)
    : '';
  const full = branchNameOrNull(mergeRequest) ?? '';
  if (stringWidth(full) <= width) {
    return full;
  }

  const separator = ' → ';
  const targetWidth = Math.min(
    stringWidth(target),
    Math.max(4, Math.floor((width - stringWidth(separator)) * 0.4)),
  );
  const sourceWidth = Math.max(
    1,
    width - stringWidth(separator) - targetWidth,
  );
  return `${truncateText(source, sourceWidth)}${separator}${truncateText(
    target,
    targetWidth,
  )}`;
}

function relativeTime(value, now) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    return printable(value);
  }

  const difference = Math.max(0, now.valueOf() - date.valueOf());
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (difference < minute) {
    return '刚刚';
  }
  if (difference < hour) {
    return `${Math.floor(difference / minute)} 分钟前`;
  }
  if (difference < day) {
    return `${Math.floor(difference / hour)} 小时前`;
  }
  if (difference <= 30 * day) {
    return `${Math.floor(difference / day)} 天前`;
  }
  return date.toISOString().slice(0, 10);
}

function detailTime(value) {
  if (value === null || value === undefined) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? safeHumanText(value) : date.toISOString();
}

function printable(value) {
  if (value === null || value === undefined || value === '') {
    return '-';
  }
  return safeHumanText(value).replace(/[\r\n\t]+/g, ' ');
}

function wrapMultiline(value, width, indent = '') {
  return safeHumanText(value)
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, '  ')
    .split('\n')
    .map((line) => wrapWithIndent(line, width, indent, indent))
    .join('\n');
}

function wrapWithIndent(value, width, firstIndent = '', nextIndent = firstIndent) {
  const available = Math.max(
    1,
    width - Math.max(stringWidth(firstIndent), stringWidth(nextIndent)),
  );
  const wrapped = wrapAnsi(String(value), available, {
    hard: true,
    trim: false,
    wordWrap: true,
  }).split('\n');
  return wrapped
    .map((line, index) => `${index === 0 ? firstIndent : nextIndent}${line}`)
    .join('\n');
}

function truncateText(value, width) {
  const text = safeHumanText(value);
  if (stringWidth(text) <= width) {
    return text;
  }
  if (width <= 1) {
    return '…'.slice(0, width);
  }

  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  let result = '';
  for (const { segment } of segmenter.segment(text)) {
    if (stringWidth(`${result}${segment}…`) > width) {
      break;
    }
    result += segment;
  }
  return `${result}…`;
}

function padCell(value, width) {
  const text = String(value);
  return `${text}${' '.repeat(Math.max(0, width - stringWidth(text)))}`;
}

function yesNo(value) {
  return value ? '是' : '否';
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function safeHumanText(value) {
  return String(value).replace(
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g,
    (character) =>
      `\\u${character.codePointAt(0).toString(16).padStart(4, '0')}`,
  );
}
