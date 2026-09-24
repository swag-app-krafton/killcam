#!/usr/bin/env bash
# Vendors swagperf's design system into the Killcam dashboard.
#
#   scripts/sync-design-system.sh [path/to/perfetto-monitor] [--fonts]
#
# dashboard/src/design/ is an exact mirror of perfetto-monitor/frontend/src/design/.
# Never edit it: wrap or extend it in Killcam's own code (dashboard/src/kit/), so that
# merging the two dashboards later is a deletion. This script overwrites the folder
# (rsync --delete) and records the source commit in dashboard/design-system.lock.
#
# --fonts also refreshes dashboard/src/fonts/ (self-hosted copies of the Google
# Fonts swagperf links from frontend/index.html). That needs network access once;
# the built dashboard never makes external requests.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="../perfetto-monitor"
FONTS=0
for arg in "$@"; do
  case "$arg" in
    --fonts) FONTS=1 ;;
    -h | --help) sed -n '2,14p' "$0"; exit 0 ;;
    *) SRC="$arg" ;;
  esac
done
case "$SRC" in /*) ;; *) SRC="$HERE/$SRC" ;; esac

FROM="$SRC/frontend/src/design"
TO="$HERE/dashboard/src/design"
if [ ! -f "$FROM/index.ts" ]; then
  echo "error: no design system at $FROM (pass the perfetto-monitor checkout as the first argument)" >&2
  exit 1
fi

mkdir -p "$TO"
rsync -a --delete "$FROM/" "$TO/"

REV="$(git -C "$SRC" rev-parse HEAD 2>/dev/null || echo unknown)"
DIRTY="$(git -C "$SRC" status --porcelain -- frontend/src/design 2>/dev/null | head -1)"
{
  echo "# Written by scripts/sync-design-system.sh. dashboard/src/design is vendored: do not edit it."
  echo "source: perfetto-monitor/frontend/src/design"
  echo "commit: $REV${DIRTY:+ (with uncommitted changes)}"
  echo "synced: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "files: $(find "$TO" -type f | wc -l | tr -d ' ')"
} >"$HERE/dashboard/design-system.lock"

if [ "$FONTS" = 1 ]; then
  node "$HERE/dashboard/dev/fetch-fonts.mjs" "$SRC/frontend/index.html" "$HERE/dashboard/src/fonts"
fi

echo "synced $(find "$TO" -type f | wc -l | tr -d ' ') files from $FROM at ${REV:0:10}"
