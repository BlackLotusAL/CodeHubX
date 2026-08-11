#!/usr/bin/env node

import { runCli } from '../src/cli.js';

const controller = new AbortController();
const onSignal = () => controller.abort(new Error('USER_CANCELLED'));

process.once('SIGINT', onSignal);
process.once('SIGTERM', onSignal);

try {
  process.exitCode = await runCli(process.argv.slice(2), {
    signal: controller.signal,
  });
} finally {
  process.removeListener('SIGINT', onSignal);
  process.removeListener('SIGTERM', onSignal);
}
