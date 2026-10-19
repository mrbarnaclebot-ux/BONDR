#!/bin/sh
# The phase 1 gate in one command, from the repo root: sh scripts/spike/all.sh (pnpm spike:all).
# No `set -e`: the page must be written even when the run or the check fails, so every step runs and the
# statuses are only combined at the end.

# A fork this script started is stopped on exit; one that was already up belongs to someone else.
up=$(sh scripts/spike/fork.sh up)
up_status=$?
echo "$up"
case "$up" in
  *"fork up on"*)
    trap 'sh scripts/spike/fork.sh down' EXIT
    trap 'exit 130' INT TERM
    ;;
esac
if [ "$up_status" -ne 0 ]; then
  # run.ts records the fork's setup failure as row "fork.error", so the page still shows it.
  echo "fork did not start"
fi

SPIKE_NET=all pnpm -s spike
run_status=$?

pnpm -s spike:page
page_status=$?

SPIKE_NET=all pnpm -s spike:check
check_status=$?

echo "spike:all run=$run_status page=$page_status check=$check_status"
if [ "$run_status" -ne 0 ] || [ "$page_status" -ne 0 ] || [ "$check_status" -ne 0 ]; then exit 1; fi
exit 0
