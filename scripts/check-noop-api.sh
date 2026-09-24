#!/usr/bin/env bash
# Fails when killcam and killcam-no-op disagree on their public API.
# Release builds link against the no-op, so any method the real artifact has
# and the no-op lacks becomes a release-only compile error in the app.
set -euo pipefail
cd "$(dirname "$0")/.."
./gradlew -q :killcam:compileDebugKotlin :killcam-no-op:compileReleaseKotlin

real=killcam/build/tmp/kotlin-classes/debug
noop=killcam-no-op/build/tmp/kotlin-classes/release
status=0
for cls in Killcam KillcamInterceptor KillcamConfig KillcamLevel KillcamFlagListener KillcamNetworkProfile KillcamFailure; do
  # Internal Kotlin members compile to public, name-mangled ($) methods; they are not API.
  signatures() { javap -public -cp "$1" "com.krafton.killcam.$cls" | grep -v '\$' | sed 's/^ *//' | sort; }
  if ! diff <(signatures "$real") <(signatures "$noop") > /tmp/killcam-api.diff; then
    echo "✗ $cls differs (< killcam, > killcam-no-op):"
    cat /tmp/killcam-api.diff
    status=1
  else
    echo "✓ $cls"
  fi
done
exit $status
