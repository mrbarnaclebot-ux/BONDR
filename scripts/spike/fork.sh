#!/bin/sh
# Surfpool mainnet fork on 127.0.0.1:18899. Usage, from the repo root: sh scripts/spike/fork.sh up|down
# The Helius key is only ever an env value or piped on stdin, never a command argument, so `ps` never shows it.
set -eu

DIR=.cache/surfpool
BIN=$DIR/surfpool
URL=http://127.0.0.1:18899

answers() {
  curl -s -m 2 -X POST -H 'content-type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"getSlot"}' "$URL" | grep -q '"result"'
}

up() {
  if answers; then echo "fork already up"; exit 0; fi
  mkdir -p "$DIR"
  if [ ! -x "$BIN" ]; then
    # ponytail: darwin-arm64 only; add the asset name per `uname -sm` if another machine runs it.
    gh release download v1.6.1 -R solana-foundation/surfpool -p surfpool-darwin-arm64.tar.gz -D "$DIR" --clobber
    tar -xzf "$DIR/surfpool-darwin-arm64.tar.gz" -C "$DIR"
    chmod +x "$BIN"
  fi
  set -a; . ./.env; set +a
  # A hand-set upstream (the public mainnet fallback) wins over Helius.
  : "${SURFPOOL_DATASOURCE_RPC_URL:=https://mainnet.helius-rpc.com/?api-key=${helius_api_key:?missing in .env}}"
  export SURFPOOL_DATASOURCE_RPC_URL
  nohup "$BIN" start --no-tui --no-deploy --no-studio --port 18899 --ws-port 18900 \
    --log-bytes-limit 0 --log-path "$DIR/logs" > "$DIR/out.log" 2>&1 &
  echo $! > "$DIR/pid"
  i=0
  until answers; do
    i=$((i + 1))
    if [ "$i" -ge 60 ]; then echo "fork did not answer within 60 s; see $DIR/out.log"; exit 1; fi
    sleep 1
  done
  echo "fork up on 127.0.0.1:18899"
  if [ -n "${helius_api_key:-}" ] && printf %s "$helius_api_key" | grep -rqF -f - "$DIR/"; then
    echo "warning: surfpool logs contain the RPC key; they stay in gitignored .cache/"
  fi
}

down() {
  if [ -f "$DIR/pid" ]; then
    pid=$(cat "$DIR/pid")
    if kill -0 "$pid" 2>/dev/null; then kill "$pid"; fi
    rm -f "$DIR/pid"
  fi
  echo "fork down"
}

case "${1:-}" in
  up) up ;;
  down) down ;;
  *) echo "usage: sh scripts/spike/fork.sh up|down"; exit 1 ;;
esac
