#!/bin/sh
# FEE-10, RESEARCH Pattern 1 layer 2: fails if the built web client bundle carries pump SDK, web3.js or spl-token
# code. Markers: pump, PumpSwap and pump-fees program ids, web3.js constants, the Token-2022 program id.
# Usage: sh scripts/check-client-bundle.sh [--self-test | <static dir>] (default apps/web/.next/static).
MARKERS='6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P|pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA|pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ|BPFLoaderUpgradeab1e11111111111111111111111|SysvarRent111111111111111111111111111111111|ComputeBudget111111111111111111111111111111|TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'

if [ "$1" = "--self-test" ]; then
  T=$(mktemp -d) || exit 2
  mkdir "$T/chunks"
  echo 'var p="ComputeBudget111111111111111111111111111111";' > "$T/chunks/x.js"
  sh "$0" "$T" > /dev/null; bad=$?
  rm "$T/chunks/x.js"
  echo 'var ok=1;' > "$T/chunks/y.js"
  sh "$0" "$T"; clean=$?
  rm -r "$T"
  [ "$bad" -eq 1 ] && [ "$clean" -eq 0 ] && { echo "check-client-bundle: self-test ok"; exit 0; }
  echo "check-client-bundle: self-test failed (marker rc $bad, clean rc $clean)" >&2
  exit 2
fi

D=${1:-apps/web/.next/static}
[ -d "$D/chunks" ] || { echo "check-client-bundle: no build at $D" >&2; exit 2; }
grep -rlE "$MARKERS" "$D"
rc=$?
[ "$rc" -eq 1 ] && exit 0
[ "$rc" -eq 0 ] && exit 1
echo "check-client-bundle: grep failed ($rc)" >&2
exit 2
