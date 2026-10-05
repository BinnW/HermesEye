#!/usr/bin/env bash
# Emulator and real-device acceptance over hdc for HermesEye.
#
# This is the only script in the harness that touches a device. It installs the
# already-built HAPs, launches the app, runs the device Hypium suite, captures
# hilog, and pulls crash logs. It never builds: run `bash scripts/verify.sh` first.
#
# The same subcommands and flags work for the DevEco emulator and for a real device
# reached over USB; only the signing requirement differs. The emulator image accepts
# the unsigned debug HAPs that `verify.sh` produces. A real device verifies the
# signature and needs a signing configuration first -- see docs/04-test-plan.md.
#
# Usage:
#   bash scripts/device.sh status                 # targets, device identity, signing readiness
#   bash scripts/device.sh install                # install main + ohosTest HAPs
#   bash scripts/device.sh launch                 # start EntryAbility and confirm the process is alive
#   bash scripts/device.sh test                   # run the ohosTest suite, exit 0 only when it fully passes
#   bash scripts/device.sh log --app --seconds 20 # capture hilog while you interact with the app
#   bash scripts/device.sh faults                 # pull this bundle's crash/freeze logs and print the reason
#   bash scripts/device.sh uninstall              # remove both bundles from the target
#
# Options (all subcommands):
#   --target <serial>   hdc target; required when more than one is connected
#   --timeout <sec>     device test timeout passed to `aa test` (default 60000)
#   --seconds <n>       hilog capture duration (default 15)
#   --app               log: only the app process. Strongly recommended: unfiltered
#                       hilog is almost entirely system noise. Requires a running app.
#   --level <l>         log: level filter, e.g. E or DEBUG/INFO/WARN/ERROR/FATAL
#   --type <t>          log: log type filter: app, core, init
#   --domain <d>        log: hilog domain filter (this project logs on 0x0000)
#   --tag <tag>         log: hilog tag filter (this project logs under 'testTag')
#   --all               faults: include other processes, not just this bundle
#   --out <dir>         evidence directory (default docs/validation/<date>-device)
#   --allow-any-target  proceed even when the target is not an emulator (see signing notes)
#
# Exit codes: 0 success, 1 the operation failed, 2 usage or environment error.
set -uo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=scripts/lib/deveco-env.sh
. scripts/lib/deveco-env.sh

SUBCOMMAND="${1:-}"
[ $# -gt 0 ] && shift
case "$SUBCOMMAND" in
  status | install | launch | test | log | faults | uninstall) ;;
  -h | --help | help | '') sed -n '2,36p' "$0"; exit 0 ;;
  *) echo "unknown subcommand: $SUBCOMMAND" >&2; sed -n '2,36p' "$0" >&2; exit 2 ;;
esac

TARGET=""
TEST_TIMEOUT=60000
LOG_SECONDS=15
LOG_TAG=""
LOG_LEVEL=""
LOG_TYPE=""
LOG_DOMAIN=""
APP_ONLY=0
INCLUDE_ALL_FAULTS=0
OUT_DIR=""
ALLOW_ANY_TARGET=0

while [ $# -gt 0 ]; do
  case "$1" in
    --target) TARGET="${2:-}"; shift 2 ;;
    --timeout) TEST_TIMEOUT="${2:-60000}"; shift 2 ;;
    --seconds) LOG_SECONDS="${2:-15}"; shift 2 ;;
    --tag) LOG_TAG="${2:-}"; shift 2 ;;
    --app) APP_ONLY=1; shift ;;
    --level) LOG_LEVEL="${2:-}"; shift 2 ;;
    --type) LOG_TYPE="${2:-}"; shift 2 ;;
    --domain) LOG_DOMAIN="${2:-}"; shift 2 ;;
    --all) INCLUDE_ALL_FAULTS=1; shift ;;
    --out) OUT_DIR="${2:-}"; shift 2 ;;
    --allow-any-target) ALLOW_ANY_TARGET=1; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

DEVECO_HOME_RESOLVED="$(deveco_resolve || true)"
if [ -z "$DEVECO_HOME_RESOLVED" ]; then
  echo 'FAIL: cannot locate DevEco Studio; run `bash scripts/doctor.sh`.' >&2
  exit 2
fi
deveco_export_env "$DEVECO_HOME_RESOLVED"
if [ ! -x "$DEVECO_HDC" ]; then
  echo "FAIL: hdc not found at $DEVECO_HDC" >&2
  exit 2
fi
HDC="$DEVECO_HDC"

# ---------------------------------------------------------------- project identity
BUNDLE="$(sed -n 's/.*"bundleName"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' AppScope/app.json5 | head -1)"
TEST_MODULE="$(sed -n 's/.*"name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' entry/src/ohosTest/module.json5 | head -1)"
MAIN_HAP="entry/build/default/outputs/default/entry-default-unsigned.hap"
TEST_HAP="entry/build/default/outputs/ohosTest/entry-ohosTest-unsigned.hap"
[ -n "$BUNDLE" ] || { echo 'FAIL: cannot read bundleName from AppScope/app.json5' >&2; exit 2; }
[ -n "$TEST_MODULE" ] || TEST_MODULE='entry_test'

EVIDENCE_DIR="${OUT_DIR:-docs/validation/$(date '+%Y-%m-%d')-device}"
mkdir -p "$EVIDENCE_DIR"

# Run hdc against the selected target, capturing output for the evidence bundle.
hdc_run() {
  if [ -n "$TARGET" ]; then "$HDC" -t "$TARGET" "$@"; else "$HDC" "$@"; fi
}

targets() {
  "$HDC" list targets 2>/dev/null | grep -v '^\[Empty\]' | grep -v '^$'
}

resolve_target() {
  local list
  list="$(targets)"
  if [ -z "$list" ]; then
    echo 'FAIL: no hdc target. Start the DevEco emulator or connect a device with USB debugging on.' >&2
    return 1
  fi
  if [ -z "$TARGET" ]; then
    TARGET="$(printf '%s\n' "$list" | head -1)"
    if [ "$(printf '%s\n' "$list" | wc -l | tr -d ' ')" -gt 1 ]; then
      echo "note: multiple targets connected; using $TARGET (override with --target)" >&2
    fi
  fi
  return 0
}

device_param() { hdc_run shell param get "$1" 2>/dev/null | tr -d '\r' | head -1; }

# PID of the running app process, empty when the app is not running.
# `pidof` can list several PIDs; the first is the main process.
app_pid() {
  hdc_run shell "pidof $BUNDLE" 2>/dev/null | tr -d '\r' | awk '{print $1}'
}

# The emulator image accepts unsigned debug HAPs; a real device does not.
device_kind() {
  case "$(device_param const.product.model)" in
    emulator*) echo emulator ;;
    *) echo device ;;
  esac
}

require_signed_readiness() {
  local kind="$1"
  if [ "$kind" = "emulator" ]; then return 0; fi
  if grep -Eq '"signingConfigs"[[:space:]]*:[[:space:]]*\[[[:space:]]*\]' build-profile.json5; then
    echo 'FAIL: this target is a real device and build-profile.json5 declares no signing configuration.' >&2
    echo '      The unsigned HAPs produced by verify.sh cannot be installed on a real device.' >&2
    echo '      Configure signing (DevEco: File > Project Structure > Signing Configs, then copy the' >&2
    echo '      generated signingConfigs block into build-profile.json5) and rebuild.' >&2
    echo '      Pass --allow-any-target to attempt the install anyway.' >&2
    return 1
  fi
  return 0
}

# ---------------------------------------------------------------- summary helpers
emit_evidence() {
  local name="$1"
  shift
  printf '%s\n' "$*" >"$EVIDENCE_DIR/$name"
}

parse_test_report() {
  # Read an `aa test` transcript on stdin; print the result line. Non-zero when
  # the suite did not fully pass.
  local transcript
  transcript="$(cat)"
  local result
  result="$(printf '%s\n' "$transcript" | grep 'OHOS_REPORT_RESULT: stream=Tests run:' | tail -1)"
  if [ -z "$result" ]; then
    echo 'FAIL: no test result line in the device transcript' >&2
    return 1
  fi
  local numbers
  numbers="$(printf '%s' "$result" | sed -n 's/.*Tests run: \([0-9]*\), Failure: \([0-9]*\), Error: \([0-9]*\), Pass: \([0-9]*\), Ignore: \([0-9]*\).*/\1 \2 \3 \4/p')"
  # shellcheck disable=SC2086
  set -- $numbers
  local run="${1:-0}" failure="${2:-0}" error="${3:-0}" pass="${4:-0}"
  if [ "$run" -eq 0 ] || [ "$failure" -ne 0 ] || [ "$error" -ne 0 ] || [ "$run" -ne "$pass" ]; then
    echo "FAIL: run=$run failure=$failure error=$error pass=$pass" >&2
    return 1
  fi
  echo "OK: $run/$run device tests passed"
  return 0
}

# ---------------------------------------------------------------- subcommands
case "$SUBCOMMAND" in
  status)
    resolve_target || exit 1
    printf 'target:   %s\n' "$TARGET"
    kind="$(device_kind)"
    printf 'kind:     %s\n' "$kind"
    printf 'model:    %s\n' "$(device_param const.product.model)"
    printf 'api:      %s\n' "$(device_param const.ohos.apiversion)"
    printf 'software: %s\n' "$(device_param const.product.software.version)"
    printf 'bundle:   %s\n' "$BUNDLE"
    printf 'test mod: %s\n' "$TEST_MODULE"
    if hdc_run shell bm dump -a 2>/dev/null | tr ',' '\n' | grep -q "$BUNDLE"; then
      printf 'installed: yes\n'
    else
      printf 'installed: no\n'
    fi
    printf '\nartifacts:\n'
    for hap in "$MAIN_HAP" "$TEST_HAP"; do
      if [ -f "$hap" ]; then printf '  present  %s\n' "$hap"; else printf '  MISSING  %s\n' "$hap"; fi
    done
    printf '\nsigning:  '
    if grep -Eq '"signingConfigs"[[:space:]]*:[[:space:]]*\[[[:space:]]*\]' build-profile.json5; then
      printf 'none declared (unsigned HAPs; emulator accepts them, a real device will not)\n'
    else
      printf 'configured in build-profile.json5\n'
    fi
    exit 0
    ;;

  install)
    resolve_target || exit 1
    kind="$(device_kind)"
    if [ "$ALLOW_ANY_TARGET" -eq 0 ]; then require_signed_readiness "$kind" || exit 1; fi
    FAILED=0
    for hap in "$MAIN_HAP" "$TEST_HAP"; do
      if [ ! -f "$hap" ]; then
        echo "FAIL: $hap missing; run \`bash scripts/verify.sh\` first" >&2
        FAILED=1
        continue
      fi
      echo "installing $(basename "$hap")..."
      out="$(hdc_run install "$hap" 2>&1)"
      printf '%s\n' "$out"
      if printf '%s' "$out" | grep -q 'install bundle successfully'; then
        echo "  OK"
      else
        echo "  FAIL"
        FAILED=1
      fi
    done
    emit_evidence 'install.txt' "$(printf 'target=%s bundle=%s\n' "$TARGET" "$BUNDLE")"
    [ "$FAILED" -eq 0 ] && exit 0
    exit 1
    ;;

  launch)
    resolve_target || exit 1
    out="$(hdc_run shell aa start -a EntryAbility -b "$BUNDLE" 2>&1)"
    printf '%s\n' "$out"
    sleep 2
    running="$(hdc_run shell "ps -ef | grep $BUNDLE | grep -v grep" 2>&1 | head -1)"
    if [ -n "$running" ]; then
      echo "running: $running"
      exit 0
    fi
    echo 'FAIL: process not found after launch' >&2
    exit 1
    ;;

  test)
    resolve_target || exit 1
    kind="$(device_kind)"
    if [ "$ALLOW_ANY_TARGET" -eq 0 ]; then require_signed_readiness "$kind" || exit 1; fi
    if ! hdc_run shell bm dump -a 2>/dev/null | tr ',' '\n' | grep -q "$BUNDLE"; then
      echo 'FAIL: bundle not installed; run `bash scripts/device.sh install` first' >&2
      exit 1
    fi
    echo "running ohosTest suite ($TEST_MODULE/${BUNDLE}) with timeout ${TEST_TIMEOUT}ms..."
    transcript="$(hdc_run shell aa test -b "$BUNDLE" -m "$TEST_MODULE" -s unittest OpenHarmonyTestRunner -s timeout "$TEST_TIMEOUT" 2>&1)"
    printf '%s\n' "$transcript" >"$EVIDENCE_DIR/device-test.txt"
    if printf '%s\n' "$transcript" | parse_test_report >"$EVIDENCE_DIR/device-test-summary.txt" 2>&1; then
      cat "$EVIDENCE_DIR/device-test-summary.txt"
      echo "evidence: $EVIDENCE_DIR/device-test.txt"
      exit 0
    fi
    cat "$EVIDENCE_DIR/device-test-summary.txt" >&2
    echo '--- transcript tail ---' >&2
    printf '%s\n' "$transcript" | tail -25 >&2
    echo "evidence: $EVIDENCE_DIR/device-test.txt" >&2
    exit 1
    ;;

  log)
    resolve_target || exit 1
    out_file="$EVIDENCE_DIR/hilog.txt"
    # The remote command must be one string: passing an option as a separate argv entry
    # lets hdc consume it as an hdc option instead of forwarding it to the device shell.
    # Blocking `hilog` (no -x) streams live entries; -x would dump the whole ring buffer.
    remote="hilog"
    [ -n "$LOG_TYPE" ] && remote="$remote -t $LOG_TYPE"
    [ -n "$LOG_LEVEL" ] && remote="$remote -L $LOG_LEVEL"
    [ -n "$LOG_DOMAIN" ] && remote="$remote -D $LOG_DOMAIN"
    [ -n "$LOG_TAG" ] && remote="$remote -T $LOG_TAG"
    if [ "$APP_ONLY" -eq 1 ]; then
      pid="$(app_pid)"
      if [ -z "$pid" ]; then
        echo "FAIL: $BUNDLE is not running, so --app cannot resolve a pid." >&2
        echo '      Start it first:  bash scripts/device.sh launch' >&2
        exit 1
      fi
      remote="$remote -P $pid"
      echo "app-only: pid $pid"
    else
      echo 'note: unfiltered hilog is mostly system noise; add --app to see only this app' >&2
    fi
    echo "capturing hilog for ${LOG_SECONDS}s -> $out_file"
    ( hdc_run shell "$remote" >"$out_file" 2>&1 ) &
    capture=$!
    (
      sleep "$LOG_SECONDS"
      kill -TERM "$capture" 2>/dev/null
    ) >/dev/null 2>&1 &
    watcher=$!
    # Wait for the timed capture to end first; tearing down the watcher before this
    # would kill its `sleep` and block here forever.
    wait "$capture" 2>/dev/null
    if command -v pkill >/dev/null 2>&1; then pkill -P "$watcher" 2>/dev/null; fi
    kill "$watcher" 2>/dev/null
    wait "$watcher" 2>/dev/null
    lines="$(wc -l <"$out_file" | tr -d ' ')"
    echo "captured $lines line(s)"
    if [ "$lines" -gt 0 ]; then
      echo '--- tail ---'
      tail -15 "$out_file"
      exit 0
    fi
    echo 'FAIL: hilog produced no output' >&2
    exit 1
    ;;

  faults)
    resolve_target || exit 1
    FAULT_DIR='/data/log/faultlog/faultlogger'
    listing="$(hdc_run shell "ls $FAULT_DIR 2>/dev/null" 2>&1 | tr -d '\r' | grep -v '^$' || true)"
    if [ -z "$listing" ]; then
      echo "FAIL: cannot list $FAULT_DIR (it may require a debug build or root)" >&2
      exit 1
    fi
    if [ "$INCLUDE_ALL_FAULTS" -eq 1 ]; then
      matches="$listing"
      echo 'scope: all processes'
    else
      # Fault files are named <kind>-<bundle>-<uid>-<timestamp>.log
      matches="$(printf '%s\n' "$listing" | grep -F -- "-$BUNDLE-" || true)"
      echo "scope: $BUNDLE (use --all for every process)"
    fi
    if [ -z "$matches" ]; then
      echo "no fault logs for $BUNDLE"
      exit 0
    fi
    count="$(printf '%s\n' "$matches" | wc -l | tr -d ' ')"
    echo "found $count fault log(s)"
    mkdir -p "$EVIDENCE_DIR/faultlog"
    printf '%s\n' "$matches" >"$EVIDENCE_DIR/faultlog/index.txt"
    for fault in $matches; do
      printf '\n=== %s ===\n' "$fault"
      if ! hdc_run file recv "$FAULT_DIR/$fault" "$EVIDENCE_DIR/faultlog/" >/dev/null 2>&1; then
        echo "  FAIL: could not pull $fault" >&2
        continue
      fi
      local_file="$EVIDENCE_DIR/faultlog/$fault"
      grep -E '^(Timestamp|Module name|Reason|Error name|Error message):' "$local_file" 2>/dev/null | sed 's/^/  /'
      stack="$(awk '/^Stacktrace:/{flag=1;next}/^$/{if(flag)exit}flag' "$local_file" 2>/dev/null | head -3)"
      if [ -n "$stack" ]; then
        printf '  Stacktrace (top 3):\n'
        printf '%s\n' "$stack" | sed 's/^/    /'
      fi
    done
    echo
    echo "pulled to: $EVIDENCE_DIR/faultlog/"
    exit 0
    ;;

  uninstall)
    resolve_target || exit 1
    out="$(hdc_run uninstall "$BUNDLE" 2>&1)"
    printf '%s\n' "$out"
    if printf '%s' "$out" | grep -q 'uninstall.*successfully'; then exit 0; fi
    echo "note: uninstall did not report success; the bundle may not have been installed" >&2
    exit 0
    ;;
esac
