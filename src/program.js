import { Command, Option } from 'commander';
import { DEFAULT_TIMEOUT } from './constants.js';
import { commanderPositiveId } from './validation.js';

export function createProgram({ execute, io }) {
  const program = new Command();
  program
    .name('codehub')
    .description('面向 AI Agent、自动化脚本、CI 和内部开发者的 CodeHub 命令行客户端')
    .helpOption('-h, --help', '显示帮助')
    .helpCommand(false)
    .showHelpAfterError(false)
    .showSuggestionAfterError(false)
    .configureHelp({ showGlobalOptions: true })
    .exitOverride()
    .configureOutput({
      writeOut: (value) => io.stdout(localiseHelp(value)),
      writeErr: () => {},
      outputError: () => {},
    })
    .option('--output <json|human>', '输出格式', 'json')
    .option('--timeout <duration>', '单次 HTTP 请求超时', DEFAULT_TIMEOUT);

  const config = program.command('config').description('管理 CodeHub 配置');
  config
    .command('init')
    .description('创建用户配置文件')
    .action(action('config.init', 0));

  const auth = program.command('auth').description('管理 CodeHub 认证');
  auth
    .command('login')
    .description('在交互式终端中登录')
    .action(action('auth.login', 0));
  auth
    .command('status')
    .description('查看本地认证状态')
    .action(action('auth.status', 0));
  auth
    .command('logout')
    .description('删除本地认证凭据')
    .action(action('auth.logout', 0));

  const repo = program.command('repo').description('查询 CodeHub Project');
  repo
    .command('list')
    .description('列出 Group 中的 Project')
    .argument('<group-id>', 'Group ID', commanderPositiveId)
    .action(action('repo.list', 1));
  repo
    .command('view')
    .description('查看 Project 详情')
    .argument('<project-id>', 'Project ID', commanderPositiveId)
    .action(action('repo.view', 1));

  const mr = program.command('mr').description('查询 Merge Request');
  mr
    .command('list')
    .description('列出 Project 中的 Merge Request')
    .addOption(projectOption())
    .option('--state <state>', 'open|closed|locked|merged|all', 'open')
    .action(action('mr.list', 0));
  mr
    .command('view')
    .description('查看 Merge Request 详情')
    .argument('<iid>', 'Project 内 MR IID', commanderPositiveId)
    .addOption(projectOption())
    .action(action('mr.view', 1));
  mr
    .command('commits')
    .description('列出 Merge Request 包含的 Commit')
    .argument('<iid>', 'Project 内 MR IID', commanderPositiveId)
    .addOption(projectOption())
    .action(action('mr.commits', 1));

  const comment = mr.command('comment').description('管理 Merge Request 评论');
  comment
    .command('create')
    .description('创建 Merge Request 评论')
    .argument('<iid>', 'Project 内 MR IID', commanderPositiveId)
    .addOption(projectOption())
    .addOption(new Option('--body <text>', '评论正文').makeOptionMandatory())
    .option('--severity <severity>', 'suggestion|minor|major|fatal', 'suggestion')
    .action(action('mr.comment.create', 1));

  return program;

  function action(commandName, positionalCount) {
    return async (...parameters) => {
      const command = parameters.at(-1);
      await execute(
        commandName,
        parameters.slice(0, positionalCount),
        command.optsWithGlobals(),
      );
    };
  }
}

function projectOption() {
  return new Option('--project-id <id>', 'Merge Request 所属 Project ID')
    .makeOptionMandatory()
    .argParser(commanderPositiveId);
}

function localiseHelp(value) {
  return String(value)
    .replace(/^Usage:/gm, '用法:')
    .replace(/^Arguments:/gm, '参数:')
    .replace(/^Options:/gm, '选项:')
    .replace(/^Global Options:/gm, '全局选项:')
    .replace(/^Commands:/gm, '命令:')
    .replace(/display help for command/g, '显示指定命令的帮助')
    .replace(/\(default:/g, '(默认:');
}
