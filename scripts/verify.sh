#!/usr/bin/env bash
# Unified verification pipeline for the HermesEye HarmonyOS harness.
#
# Runs, in order: production logic suites -> HAP compile -> ohosTest HAP compile ->
# local Hypium unit tests, and writes an evidence bundle under docs/validation/.
# It never signs, installs, or launches anything on a device; use scripts/device.sh
# for that. Builds here are unsigned and are compile evidence only.
#
# Usage:
#   bash scripts/verify.sh                          # full pipeline, evidence under docs/validation/
#   bash scripts/verify.sh --label my-change        # name the evidence directory
#   bash scripts/verify.sh --skip-build             # logic suites only (fast, seconds)
#   bash scripts/verify.sh --no-unit-test           # skip the Hypium test task
#   bash scripts/verify.sh --deny-arkts-warnings    # treat ArkTS compiler warnings as failures
#   bash scripts/verify.sh --keep-going             # do not stop at the first failing stage
#   bash scripts/verify.sh --timeout 1800           # per-stage timeout in seconds
#
# Exit codes: 0 every executed stage passed, 1 a stage failed, 2 the environment is unusable.
set -uo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=scripts/lib/deveco-env.sh
. scripts/lib/deveco-env.sh

LABEL="verify"
DATE="$(date '+%Y-%m-%d')"
EVIDENCE_ROOT="docs/validation"
SKIP_BUILD=0
NO_UNIT_TEST=0
DENY_ARKTS_WARNINGS=0
KEEP_GOING=0
STAGE_TIMEOUT=900

while [ $# -gt 0 ]; do
  case "$1" in
    --label) LABEL="${2:-}"; shift 2 ;;
    --date) DATE="${2:-}"; shift 2 ;;
    --out) EVIDENCE_ROOT="${2:-}"; shift 2 ;;
    --skip-build) SKIP_BUILD=1; shift ;;
    --no-unit-test) NO_UNIT_TEST=1; shift ;;
    --deny-arkts-warnings) DENY_ARKTS_WARNINGS=1; shift ;;
    --keep-going) KEEP_GOING=1; shift ;;
    --timeout) STAGE_TIMEOUT="${2:-900}"; shift 2 ;;
    -h | --help) sed -n '2,18p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

DEVECO_HOME_RESOLVED="$(deveco_resolve || true)"
if [ -z "$DEVECO_HOME_RESOLVED" ]; then
  echo 'FAIL: cannot locate DevEco Studio. Run `bash scripts/doctor.sh` for details.' >&2
  exit 2
fi
deveco_export_env "$DEVECO_HOME_RESOLVED"
for required in DEVECO_NODE DEVECO_HVIGORW; do
  if [ ! -e "${!required}" ]; then
    echo "FAIL: $required points at a missing file (${!required})" >&2
    exit 2
  fi
done

EVIDENCE_DIR="$EVIDENCE_ROOT/${DATE}-${LABEL}"
mkdir -p "$EVIDENCE_DIR"
LOG="$EVIDENCE_DIR/results.txt"
: >"$LOG"

STAGE_IDS=()
STAGE_STATUS=()
STAGE_SECONDS=()
STAGE_NOTES=()
FAILED=0

log() { printf '%s\n' "$*" | tee -a "$LOG"; }

# run_stage <id> <description> <command...>
run_stage() {
  local id="$1" description="$2"
  shift 2
  local stage_log="$EVIDENCE_DIR/$id.log"
  local started ended rc
  printf '\n=== %s: %s ===\n' "$id" "$description" | tee -a "$LOG"
  started="$(date +%s)"
  "$@" >"$stage_log" 2>&1 &
  local pid=$!
  # The watcher must not inherit stdout/stderr: its `sleep` child would otherwise
  # hold a caller's pipe open for the whole timeout after the stage already ended.
  (
    sleep "$STAGE_TIMEOUT"
    kill -TERM "$pid" 2>/dev/null
  ) >/dev/null 2>&1 &
  local watcher=$!
  wait "$pid"
  rc=$?
  # Drop the watcher's `sleep` child first: SIGTERM to the subshell does not
  # forward to it, and a stray 15-minute sleep per stage is not acceptable.
  if command -v pkill >/dev/null 2>&1; then pkill -P "$watcher" 2>/dev/null; fi
  kill "$watcher" 2>/dev/null
  wait "$watcher" 2>/dev/null
  ended="$(date +%s)"

  local note=''
  # ArkTS diagnostics only exist for stages that invoke the compiler.
  local track_arkts=0
  case "$id" in
    hap-* | hypium-*) track_arkts=1 ;;
  esac
  if grep -qE 'ArkTS:ERROR|ERROR: ArkTS' "$stage_log" 2>/dev/null; then
    note="$(grep -cE 'ArkTS:ERROR|ERROR: ArkTS' "$stage_log") ArkTS error(s)"
  fi
  local arkts_warns=0
  if [ "$track_arkts" -eq 1 ]; then
    arkts_warns="$(grep -cE 'ArkTS:WARN' "$stage_log" 2>/dev/null || true)"
    arkts_warns="${arkts_warns:-0}"
  fi

  if [ "$rc" -ne 0 ]; then
    if [ "$rc" -eq 143 ] || [ "$rc" -eq 137 ]; then
      note="timed out after ${STAGE_TIMEOUT}s${note:+; $note}"
    fi
    note="${note:-$(tail -3 "$stage_log" | tr '\n' ' ')}"
    printf '  FAIL (rc=%s, %ss)%s\n' "$rc" "$((ended - started))" "${note:+ -> $note}" | tee -a "$LOG"
    printf '  log: %s\n' "$stage_log" | tee -a "$LOG"
    FAILED=1
  elif [ "$DENY_ARKTS_WARNINGS" -eq 1 ] && [ "$arkts_warns" -gt 0 ]; then
    note="$arkts_warns ArkTS warning(s) denied by --deny-arkts-warnings"
    printf '  FAIL (%ss) -> %s\n' "$((ended - started))" "$note" | tee -a "$LOG"
    printf '  log: %s\n' "$stage_log" | tee -a "$LOG"
    FAILED=1
  else
    if [ "$track_arkts" -eq 1 ]; then
      note="${arkts_warns} ArkTS warning(s)"
    fi
    printf '  PASS (%ss)%s\n' "$((ended - started))" "$( [ "$arkts_warns" -gt 0 ] && printf ' -> %s' "$note")" | tee -a "$LOG"
  fi

  STAGE_IDS+=("$id")
  STAGE_NOTES+=("$note")
  STAGE_SECONDS+=("$((ended - started))")
  if { [ "$rc" -ne 0 ] || { [ "$DENY_ARKTS_WARNINGS" -eq 1 ] && [ "$arkts_warns" -gt 0 ]; }; }; then
    STAGE_STATUS+=("fail")
  else
    STAGE_STATUS+=("pass")
  fi
  return 0
}

should_run() {
  # honour --keep-going / fail-fast in one place
  [ "$FAILED" -eq 0 ] || [ "$KEEP_GOING" -eq 1 ]
}

log "HermesEye verification"
log "label:      $LABEL"
log "date:       $DATE"
log "repository: $(pwd)"
log "deveco:     $DEVECO_HOME"
log "node:       $DEVECO_NODE ($("$DEVECO_NODE" -v 2>/dev/null))"
log "sdk api:    $(deveco_sdk_api_version "$DEVECO_HOME" || echo unknown) (project targets $(project_compatible_sdk build-profile.json5 || echo unknown))"
log "timeout:    ${STAGE_TIMEOUT}s per stage"

# ---------------------------------------------------------------- logic suites
should_run && run_stage logic-domain 'production domain rules (scripts/test-domain.cjs)' \
  "$DEVECO_NODE" scripts/test-domain.cjs
should_run && run_stage logic-services 'transport and persistence adapters (scripts/test-services.cjs)' \
  "$DEVECO_NODE" scripts/test-services.cjs
should_run && run_stage logic-workspace 'V1.0 workspace isolation, migration, secure save (scripts/test-workspace.cjs)' \
  "$DEVECO_NODE" scripts/test-workspace.cjs

# ---------------------------------------------------------------- compile
if [ "$SKIP_BUILD" -eq 0 ]; then
  should_run && run_stage hap-default 'compile entry HAP (debug, unsigned)' \
    "$DEVECO_NODE" "$DEVECO_HVIGORW" --mode module -p product=default -p module=entry@default \
    -p buildMode=debug assembleHap --no-daemon
  should_run && run_stage hap-ohostest 'compile ohosTest HAP (debug, unsigned)' \
    "$DEVECO_NODE" "$DEVECO_HVIGORW" --mode module -p product=default -p module=entry@ohosTest \
    -p buildMode=debug assembleHap --no-daemon

  if [ "$NO_UNIT_TEST" -eq 0 ]; then
    should_run && run_stage hypium-local 'run local Hypium unit tests' \
      "$DEVECO_NODE" "$DEVECO_HVIGORW" --mode module -p product=default -p module=entry@default \
      -p buildMode=debug test --no-daemon

    if should_run && [ -f "$EVIDENCE_DIR/hypium-local.log" ]; then
      RESULT_FILE="$(find entry/.test -name test_result.txt -type f 2>/dev/null | head -1 || true)"
      if [ -z "$RESULT_FILE" ]; then
        printf '\n=== hypium-result: local Hypium result ===\n' | tee -a "$LOG"
        printf '  FAIL -> no test_result.txt produced under entry/.test\n' | tee -a "$LOG"
        FAILED=1
        STAGE_IDS+=("hypium-result")
        STAGE_STATUS+=("fail")
        STAGE_SECONDS+=("0")
        STAGE_NOTES+=("no test_result.txt produced")
      else
        cp "$RESULT_FILE" "$EVIDENCE_DIR/hypium-result.txt"
        SUMMARY_LINE="$(grep -E 'Tests run:' "$RESULT_FILE" | tail -1 || true)"
        printf '\n=== hypium-result: local Hypium result ===\n' | tee -a "$LOG"
        printf '  source: %s\n' "$RESULT_FILE" | tee -a "$LOG"
        printf '  %s\n' "${SUMMARY_LINE:-<no summary line>}" | tee -a "$LOG"
        if "$DEVECO_NODE" -e '
          const fs = require("node:fs");
          const result = fs.readFileSync(process.argv[1], "utf8");
          const m = result.match(/Tests run: (\d+), Failure: (\d+), Error: (\d+), Pass: (\d+), Ignore: (\d+)/);
          if (!m) { console.error("no summary line found"); process.exit(1); }
          const [, run, failure, error, pass] = m.map(Number);
          if (run === 0 || failure !== 0 || error !== 0 || run !== pass) {
            console.error(`expected run===pass with no failure/error, got run=${run} failure=${failure} error=${error} pass=${pass}`);
            process.exit(1);
          }
        ' "$RESULT_FILE" 2>>"$LOG"; then
          printf '  PASS\n' | tee -a "$LOG"
          STAGE_STATUS+=("pass")
        else
          printf '  FAIL -> unit tests did not all pass\n' | tee -a "$LOG"
          FAILED=1
          STAGE_STATUS+=("fail")
        fi
        STAGE_IDS+=("hypium-result")
        STAGE_SECONDS+=("0")
        STAGE_NOTES+=("${SUMMARY_LINE:-no summary line}")
      fi
    fi
  fi
else
  log ''
  log '(--skip-build: compile and unit-test stages skipped)'
fi

# ---------------------------------------------------------------- summary
log ''
log '=== summary ==='
PASSED=0
for i in "${!STAGE_IDS[@]}"; do
  printf '  %-4s %-16s %5ss  %s\n' "${STAGE_STATUS[$i]}" "${STAGE_IDS[$i]}" "${STAGE_SECONDS[$i]}" "${STAGE_NOTES[$i]}" | tee -a "$LOG"
  [ "${STAGE_STATUS[$i]}" = "pass" ] && PASSED=$((PASSED + 1))
done
log "  $PASSED/${#STAGE_IDS[@]} stages passed"

{
  printf '{\n'
  printf '  "label": "%s",\n' "$LABEL"
  printf '  "date": "%s",\n' "$DATE"
  printf '  "generatedAt": "%s",\n' "$(date '+%Y-%m-%dT%H:%M:%S%z')"
  printf '  "devecoHome": "%s",\n' "$DEVECO_HOME"
  printf '  "sdkApiLevel": "%s",\n' "$(deveco_sdk_api_version "$DEVECO_HOME" || echo '')"
  printf '  "projectCompatibleSdk": "%s",\n' "$(project_compatible_sdk build-profile.json5 || echo '')"
  printf '  "skipBuild": %s,\n' "$( [ "$SKIP_BUILD" -eq 1 ] && echo true || echo false )"
  printf '  "passed": %d,\n  "total": %d,\n  "ok": %s,\n' "$PASSED" "${#STAGE_IDS[@]}" \
    "$( [ "$FAILED" -eq 0 ] && echo true || echo false )"
  printf '  "stages": [\n'
  for i in "${!STAGE_IDS[@]}"; do
    if [ "$i" -lt "$((${#STAGE_IDS[@]} - 1))" ]; then sep=','; else sep=''; fi
    printf '    {"id": "%s", "status": "%s", "seconds": %s, "note": "%s"}%s\n' \
      "${STAGE_IDS[$i]}" "${STAGE_STATUS[$i]}" "${STAGE_SECONDS[$i]}" \
      "$(printf '%s' "${STAGE_NOTES[$i]}" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g')" "$sep"
  done
  printf '  ]\n}\n'
} >"$EVIDENCE_DIR/summary.json"

log ''
log "evidence: $EVIDENCE_DIR (results.txt, summary.json, per-stage *.log)"
[ "$FAILED" -eq 0 ] && log 'RESULT: PASS' || log 'RESULT: FAIL'
[ "$FAILED" -eq 0 ] && exit 0
exit 1
