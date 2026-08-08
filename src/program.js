import { Command, InvalidArgumentError, Option } from 'commander';
import { DEFAULTS } from './constants.js';

export function createProgram({ execute, io }) {
  const program = new Command();
  program
    .name('codehub')
    .description('面向 AI Agent、自动化脚本和 CI 的 CodeHub 命令行客户端')
    .helpOption('-h, --help', '显示帮助')
    .configureHelp({ showGlobalOptions: true })
    .showHelpAfterError(false)
    .exitOverride()
    .configureOutput({
      writeOut: (value) => io.stdout(localiseHelp(value)),
      // Commander 的解析错误由上层转换成唯一的结构化错误对象。
      writeErr: () => {},
      outputError: () => {},
    })
    .option(
      '--output <json|human>',
      '输出格式（业务命令默认 json，登录和配置初始化默认 human）',
    )
    .option('--request-id <id>', '调用关联 ID')
    .option('--timeout <duration>', '单次 HTTP 请求超时', DEFAULTS.timeout)
    .option('--simulate', '使用内置仿真数据，不读取真实配置或凭据，也不访问网络')
    .option('--no-input', '禁止交互式提示')
    .option('-R, --repo <project-id>', 'CodeHub Project ID');

  program
    .command('version')
    .description('显示 CLI、协议和运行时版本')
    .action(action('version'));

  program
    .command('capabilities')
    .description('显示当前 CLI 的机器能力清单')
    .action(action('capabilities'));

  const config = program.command('config').description('管理 CodeHub 服务配置');
  config
    .command('init')
    .description('在用户配置目录初始化 CodeHub 服务配置')
    .action(action('config.init'));

  const auth = program.command('auth').description('管理 CodeHub 凭据');
  auth
    .command('login')
    .description('在交互式终端中选择认证方式并登录')
    .action(action('auth.login'));

  auth
    .command('status')
    .description('检查本地是否存在 CodeHub 凭据，不访问网络')
    .action(action('auth.status'));

  auth
    .command('logout')
    .description('删除 Credential Helper 中的 CodeHub 凭据')
    .action(action('auth.logout'));

  const repo = program.command('repo').description('查询 CodeHub Project');
  repo
    .command('list <group-id>')
    .description('列出 Group 中的 Project')
    .action(action('repo.list'));

  repo
    .command('view <project-id>')
    .description('查看 Project 详情')
    .action(action('repo.view'));

  const mr = program.command('mr').description('查询 Merge Request');
  mr
    .command('list')
    .description('列出 Project 中的 Merge Request（默认仅开放）')
    .option('--state <state>', 'open|closed|locked|merged|all', 'open')
    .action(action('mr.list'));

  mr
    .command('view <iid>')
    .description('查看 Merge Request 详情')
    .action(action('mr.view'));

  mr
    .command('commits <iid>')
    .description('列出 Merge Request 包含的 Commit')
    .action(action('mr.commits'));

  const comment = mr.command('comment').description('管理 Merge Request 评论');
  comment
    .command('create <iid>')
    .description('创建普通 Merge Request Discussion')
    .addOption(
      new Option('--body-file <path>', '评论正文文件，使用 - 从 stdin 读取')
        .makeOptionMandatory()
        .argParser(onlyOnce('--body-file')),
    )
    .option(
      '--severity <severity>',
      'suggestion|minor|major|fatal',
      'suggestion',
    )
    .option('--confirm-write', '显式确认执行写入')
    .option('--dry-run', '仅验证并输出脱敏请求预览')
    .action(action('mr.comment.create'));

  return program;

  function action(commandName) {
    return async (...parameters) => {
      const command = parameters.at(-1);
      const positional = parameters.slice(0, -2);
      await execute(commandName, positional, command.optsWithGlobals());
    };
  }
}

function onlyOnce(optionName) {
  return (value, previous) => {
    if (previous !== undefined) {
      throw new InvalidArgumentError(`${optionName} 只能出现一次`);
    }
    return value;
  };
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
