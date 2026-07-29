#!/usr/bin/env node

import { runCli } from '../src/cli.js';

const controller = new AbortController();
let cancelled = false;

const cancel = () => {
  if (cancelled) {
    return;
  }

  cancelled = true;
  controller.abort(new Error('USER_CANCELLED'));
};

process.once('SIGINT', cancel);
process.once('SIGTERM', cancel);

const exitCode = await runCli(process.argv.slice(2), {
  signal: controller.signal,
});

process.exitCode = cancelled ? 130 : exitCode;
