#!/bin/sh
# Worker and web together with prefixed logs (D-26). Ctrl-C stops both. Usage: sh scripts/dev.sh (or pnpm dev:all)
# Both read the repo-root .env: the worker with --env-file, web through next.config.ts (web names only).
set -eu
cd "$(dirname "$0")/.."

# A read loop, not sed: sed block-buffers when its output is not a terminal, so lines would arrive late.
prefix() { while IFS= read -r line; do printf '%s %s\n' "$1" "$line"; done; }

# kill 0 signals the whole process group, this shell included, so the trap clears itself first.
trap 'trap - INT TERM EXIT; kill 0' INT TERM EXIT
pnpm --filter @bondr/worker dev 2>&1 | prefix "[worker]" &
pnpm --filter @bondr/web dev 2>&1 | prefix "[web]" &
wait
