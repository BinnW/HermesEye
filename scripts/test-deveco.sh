#!/usr/bin/env bash
# Deprecated alias. Kept so existing notes, CI jobs, and muscle memory keep working.
#
# It now delegates to scripts/verify.sh, which is the single verification entry
# point, so the two can no longer drift apart. It previously carried its own copy
# of the DevEco paths and of the Hypium result parsing; both moved into
# scripts/lib/deveco-env.sh and scripts/verify.sh.
#
# Does not sign, install, or claim device acceptance. Use scripts/device.sh for that.
set -uo pipefail
cd "$(dirname "$0")/.."
echo 'note: scripts/test-deveco.sh is deprecated; prefer `bash scripts/verify.sh`' >&2
exec bash scripts/verify.sh "$@"
