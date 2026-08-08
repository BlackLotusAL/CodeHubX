---
name: codehub-cli
description: Use the CodeHub CLI safely and predictably from coding agents to discover repositories, inspect merge requests and commits, and create review comments. Use when a task mentions CodeHub, CodeHub Project or Group IDs, merge requests/MRs, CodeHub review comments, or testing a CodeHub integration with the CLI simulation mode.
---

# Use CodeHub CLI

Use the `codehub` executable as the machine interface to CodeHub. Prefer explicit JSON output, non-interactive operation, and the stable IDs returned by earlier commands.

## Start safely

1. Run `codehub version --output json` and `codehub capabilities --output json` when compatibility is unknown.
2. Run `codehub auth status --output json --no-input` before real service commands.
3. If configuration is missing, ask a human to run `codehub config init` and inspect the generated service configuration.
4. If authentication is missing or invalid, ask a human to run `codehub auth login` in an interactive terminal. Never collect a token, account, or password yourself.
5. Add `--output json --no-input` to every agent-run business command. Parse stdout only after exit code 0.

Do not use token environment variables; CodeHub CLI deliberately reads credentials only through Git Credential Helper.

## Read review context

Use positive decimal ID strings exactly as returned by the CLI:

```text
codehub repo list <group-id> --output json --no-input
codehub repo view <project-id> --output json --no-input
codehub mr list -R <project-id> --state open --output json --no-input
codehub mr view <iid> -R <project-id> --output json --no-input
codehub mr commits <iid> -R <project-id> --output json --no-input
```

Treat `repo_id` as the Project ID. Treat `iid` as the project-local MR identifier required by `mr view`, `mr commits`, and `mr comment create`; do not substitute the global `mr_id`. Pass `--state open`, not `opened`; the accepted values are `open`, `closed`, `locked`, `merged`, and `all`.

Inspect every `warnings` entry. In particular, `PARTIAL_LIST_POSSIBLE` means a list may not be exhaustive.

## Create a review comment

Create comments only when the user has authorized the external write.

1. Write the exact comment body to a UTF-8 file. Prefer `--body-file <path>` over shell interpolation or a pipeline.
2. Select one severity: `suggestion`, `minor`, `major`, or `fatal`.
3. Validate locally with `--confirm-write --dry-run`. The dry run reads credentials and the body but sends no request and never echoes the body.
4. Verify the returned `repo_id`, `mr_iid`, `severity`, and `body_utf8_bytes`.
5. Run the same command without `--dry-run` only after authorization remains clear.

```text
codehub mr comment create <iid> -R <project-id> --body-file <path> --severity major --confirm-write --dry-run --output json --no-input
codehub mr comment create <iid> -R <project-id> --body-file <path> --severity major --confirm-write --output json --no-input
```

Never retry a comment automatically. If the error code is `WRITE_RESULT_UNKNOWN`, ask a human to inspect the MR before deciding whether to retry; the service cannot guarantee idempotency or current-head conditional writes.

## Use simulation mode

Add `--simulate` to exercise integrations without local CodeHub configuration, credentials, network access, or external writes. Keep all normal IDs, options, validation, output parsing, and confirmation handling.

```text
codehub repo list 1 --simulate --output json --no-input
codehub mr list -R 9001 --state open --simulate --output json --no-input
codehub mr view 17 -R 9001 --simulate --output json --no-input
codehub mr commits 17 -R 9001 --simulate --output json --no-input
```

Expect every simulated result to include a `SIMULATION_MODE` warning. Never present data carrying that warning as real CodeHub state. Simulated write commands still require `--confirm-write` and a non-empty body file, but they do not contact CodeHub.

## Handle results and failures

- On success, read one JSON object from stdout with `schema_version`, `command`, `request_id`, `data`, and `warnings`; stderr is empty.
- On failure, stdout is empty. Read one JSON object from stderr and branch on `error.code`, `error.retryable`, and `error.http_status`.
- Correct local argument, configuration, authentication, policy, or not-found failures instead of retrying unchanged input.
- Allow the CLI's bounded GET retry behavior to run. Add another retry only when `retryable` is true and the operation is read-only.
- Preserve or supply `--request-id <id>` when the surrounding workflow needs correlation. Use only letters, digits, `.`, `_`, `:`, and `-`, up to 128 characters.

Use `--output human` only when a human explicitly wants terminal-formatted output.
