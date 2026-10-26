#!/bin/sh
# The CI steps locally (D-26, mirrors .github/workflows/ci.yml): lint, typecheck, Vitest, the web build, the client
# bundle check right after it (D-23), then the worker-free @smoke set against next start. --full adds the whole
# Playwright run. Usage, from anywhere in the repo: sh scripts/test.sh [--full] (or pnpm verify [--full])
# Unlike CI it reads the root .env, so the DB suites use the Neon dev branch and wake it once per run.
set -eu
cd "$(dirname "$0")/.."

FULL=0
for a in "$@"; do
  case "$a" in
    --full) FULL=1 ;;
    --) ;;
    *) echo "usage: sh scripts/test.sh [--full]" >&2; exit 2 ;;
  esac
done
PORT=${VERIFY_PORT:-3100} # not 3000, where a dev server may already run
URL="http://127.0.0.1:$PORT"
LOG=$(mktemp)

pnpm lint
pnpm typecheck
pnpm test
pnpm --filter @bondr/web build
pnpm check:bundle

if curl -sf "$URL/terms" >/dev/null 2>&1; then echo "verify: port $PORT is busy; set VERIFY_PORT" >&2; exit 1; fi
# WORKER_URL points nowhere, as in CI: the smoke set never needs the worker (Pitfall 13).
(cd apps/web && WORKER_URL=http://127.0.0.1:9 exec ./node_modules/.bin/next start -p "$PORT") >"$LOG" 2>&1 &
WEB=$!
trap 'kill "$WEB" 2>/dev/null || true' EXIT
i=0
until curl -sf "$URL/terms" >/dev/null; do
  i=$((i + 1))
  if [ "$i" -ge 60 ]; then echo "verify: web did not answer within 60 s; see $LOG" >&2; exit 1; fi
  sleep 1
done
E2E_BASE_URL=$URL E2E_NO_SHOTS=1 pnpm exec playwright test --project=chromium --grep @smoke
kill "$WEB"
trap - EXIT

if [ "$FULL" -eq 1 ]; then pnpm e2e; fi
echo "verify: all steps passed"
