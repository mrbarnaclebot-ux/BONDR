#!/bin/sh
# One-command local setup (D-26). Usage, from anywhere in the repo: sh scripts/setup.sh (or pnpm setup:local)
# Checks node 24 and pnpm, installs, creates .env from .env.example when missing, creates the local devnet and fork
# seed files outside the repo when missing (spike:keys never overwrites one), and migrates when .env has a
# DATABASE_URL. Safe to re-run.
set -eu
cd "$(dirname "$0")/.."

node -v | grep -q '^v24\.' || { echo "setup: node 24 required, found $(node -v)" >&2; exit 1; }
command -v pnpm >/dev/null || { echo "setup: pnpm not found; run corepack enable" >&2; exit 1; }
echo "setup: node $(node -v), pnpm $(pnpm -v)"

pnpm install
if [ ! -f .env ]; then
  cp .env.example .env
  echo "setup: created .env from .env.example; fill in its values"
fi
pnpm spike:keys # prints public keys only; MASTER_SEED_FILE in .env points at ~/.bondr-spike/devnet/master.seed

if grep -q '^DATABASE_URL=.' .env; then
  pnpm db:migrate
else
  echo "setup: DATABASE_URL is not set in .env; skipped migrations"
fi
echo "setup: done. Next: pnpm dev:all"
