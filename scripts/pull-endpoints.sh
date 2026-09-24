#!/usr/bin/env bash
# Pulls the endpoint catalog from a device running a Killcam debug build and
# writes it into the app repo, ready to commit:
#
#   scripts/pull-endpoints.sh ../swag-pay/app/src/debug/assets/killcam-endpoints.json
#
# The catalog merges the repo file the build shipped with, endpoints registered
# in code, and endpoints testers added from the dashboard. Commit the result
# (and open a PR) so the next build ships them to everyone.
set -euo pipefail

out=${1:?usage: $0 <path/to/killcam-endpoints.json> [port]}
port=${2:-8090}

if command -v adb >/dev/null 2>&1; then
  adb forward "tcp:$port" "tcp:$port" >/dev/null
fi

tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT
if ! curl -fsS "http://localhost:$port/api/endpoints/export" -o "$tmp"; then
  echo "✗ Could not reach Killcam on localhost:$port (is the debug app running?)" >&2
  exit 1
fi

mkdir -p "$(dirname "$out")"
if [ -f "$out" ] && cmp -s "$tmp" "$out"; then
  echo "✓ $out is already up to date"
  exit 0
fi
cp "$tmp" "$out"
echo "✓ Wrote $out"
if git -C "$(dirname "$out")" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  git -C "$(dirname "$out")" --no-pager diff --stat -- "$(basename "$out")" || true
  echo "Next: git add $out && git commit -m 'Update Killcam endpoint catalog'"
fi
