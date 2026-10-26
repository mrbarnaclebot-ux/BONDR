#!/bin/sh
# Uploads the local checkout to Railway (D-26, D-27). Usage, from anywhere in the repo:
#   sh scripts/deploy.sh <staging|production> [--yes] [--only web|worker] [--dry-run]
#   pnpm run deploy -- staging --dry-run   (plain `pnpm deploy` is pnpm's own command)
# Order: web first when packages/core/migrations changed since the local tag deployed-<env>, or the tag is missing
# (its pre-deploy migrates and the worker needs the new tables); otherwise the worker first. Each upload waits for
# its deployment to reach SUCCESS before the next. `--only worker` is refused in the web-first case, because the
# worker would boot against an unmigrated schema. The tag moves to the commit read at the start only after every
# service succeeded, on a full deploy (no --only) from a clean tree, so it always names what runs. It is local.
# Every Railway call names the bondr project, and the checkout must be linked to it (CR-O-04).
# Production deploys only the exact origin/main commit from a clean tree, with CI green for that commit, and asks
# for the typed word unless --yes (CR-O-05). Every guard runs before --dry-run exits.
set -eu
cd "$(dirname "$0")/.."

PROJECT=cf985056-2099-4497-a2c1-1aa639343af4 # Railway project bondr (an id, not a secret)

die() { echo "deploy: $*" >&2; exit 1; }
usage() { die "usage: sh scripts/deploy.sh <staging|production> [--yes] [--only web|worker] [--dry-run]"; }

TARGET=""; YES=0; ONLY=""; DRY=0
while [ $# -gt 0 ]; do
  case "$1" in
    staging | production) TARGET=$1 ;;
    --yes) YES=1 ;;
    --dry-run) DRY=1 ;;
    --only) [ $# -ge 2 ] || usage; ONLY=$2; shift ;;
    --) ;;
    *) usage ;;
  esac
  shift
done
[ -n "$TARGET" ] || usage
case "$ONLY" in "" | web | worker) ;; *) usage ;; esac

linked=$(railway status --json 2>/dev/null | jq -r '.id // empty' 2>/dev/null) || linked=""
[ "$linked" = "$PROJECT" ] || die "this checkout is not linked to the Railway project bondr ($PROJECT)"

SHA=$(git rev-parse HEAD)
SHORT=$(git rev-parse --short HEAD)
CLEAN=1
[ -z "$(git status --porcelain)" ] || CLEAN=0
if [ "$TARGET" = production ]; then
  [ "$CLEAN" -eq 1 ] || die "production deploys need a clean tree (git status shows changes)"
  [ "$(git rev-parse --abbrev-ref HEAD)" = main ] || die "production deploys only from main"
  git fetch -q origin main || die "cannot fetch origin/main"
  [ "$SHA" = "$(git rev-parse origin/main)" ] ||
    die "production deploys only the exact origin/main commit; $SHORT is not it (pull, or merge a PR first)"
  ci=$(gh run list --commit "$SHA" --workflow ci.yml --json conclusion --jq '.[0].conclusion // "no run"') ||
    die "cannot read the CI result for $SHORT (gh)"
  [ "$ci" = success ] || die "CI is not green for $SHORT (${ci:-in progress})"
fi

# Compared with the working tree, untracked files included, because railway up uploads the working tree.
TAG="deployed-$TARGET"
if ! git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
  ORDER="web worker"; WHY="no $TAG tag"
elif ! git diff --quiet "$TAG" -- packages/core/migrations ||
  [ -n "$(git ls-files --others --exclude-standard packages/core/migrations)" ]; then
  ORDER="web worker"; WHY="migrations changed since $TAG"
else
  ORDER="worker web"; WHY="no migration change since $TAG"
fi
if [ "$ONLY" = worker ] && [ "$ORDER" = "web worker" ]; then
  die "--only worker refused: $WHY, so web must migrate first; run a full deploy (no --only)"
fi
[ -z "$ONLY" ] || ORDER=$ONLY

MOVE=0
if [ -n "$ONLY" ]; then NOTE="not moved (--only)"
elif [ "$CLEAN" -eq 0 ]; then NOTE="not moved (dirty tree)"
else MOVE=1; NOTE="moves to $SHORT after every service succeeds"; fi

echo "deploy plan: $TARGET (Railway project bondr $PROJECT, commit $SHORT)"
echo "  order: $ORDER ($WHY)"
echo "  tag $TAG: $NOTE"
if [ "$DRY" -eq 1 ]; then echo "  dry run: nothing uploaded"; exit 0; fi

if [ "$TARGET" = production ] && [ "$YES" -eq 0 ]; then
  printf "Type production to deploy to trybondr.fun: "
  read -r answer || answer=""
  [ "$answer" = production ] || die "aborted"
fi

# The checked commit is what gets uploaded and tagged: refuse if HEAD or a clean tree changed since the checks.
unchanged() {
  [ "$(git rev-parse HEAD)" = "$SHA" ] || die "HEAD moved from $SHORT during the deploy; nothing more uploaded"
  [ "$CLEAN" -eq 0 ] || [ -z "$(git status --porcelain)" ] || die "the tree changed during the deploy; nothing more uploaded"
}

# Prints "<id> <status>" of the newest deployment, or "none NONE".
newest() {
  railway deployment list --project "$PROJECT" --service "$1" --environment "$TARGET" --json --limit 1 |
    node -e 'let s="";process.stdin.on("data",(d)=>(s+=d)).on("end",()=>{const d=JSON.parse(s)[0]??{};console.log(`${d.id??"none"} ${d.status??"NONE"}`)})'
}

# Polls every 5 s, up to 15 minutes, until a deployment newer than $2 succeeds.
wait_success() {
  i=0
  while [ "$i" -lt 180 ]; do
    line=$(newest "$1"); id=${line% *}; st=${line#* }
    if [ "$id" != "$2" ]; then
      case "$st" in
        SUCCESS) echo "deploy: $1 $id SUCCESS"; return 0 ;;
        FAILED | CRASHED | REMOVED | SKIPPED) die "$1 deployment $id ended $st" ;;
      esac
    fi
    i=$((i + 1)); sleep 5
  done
  die "$1 did not reach SUCCESS within 15 minutes"
}

for svc in $ORDER; do
  unchanged
  before=$(newest "$svc"); before=${before% *}
  echo "deploy: uploading $svc ($SHORT) to $TARGET"
  railway up --project "$PROJECT" --service "$svc" --environment "$TARGET" --ci
  wait_success "$svc" "$before"
done

if [ "$MOVE" -eq 1 ]; then git tag -f "$TAG" "$SHA" >/dev/null && echo "deploy: $TAG -> $SHORT"; fi
echo "deploy: $TARGET done"
