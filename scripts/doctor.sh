#!/usr/bin/env bash
# Environment self-check for the HermesEye HarmonyOS harness.
#
# Answers one question: can this machine build and test the project right now,
# and what is missing if it cannot. It never builds, installs, or modifies
# anything; it only reads the environment.
#
# Usage:
#   bash scripts/doctor.sh                 # human-readable report
#   bash scripts/doctor.sh --json out.json # also write a machine-readable report
#   bash scripts/doctor.sh --strict        # exit 1 on warnings too
#
# Exit codes: 0 healthy, 1 at least one check failed (or any warning under --strict).
set -uo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=scripts/lib/deveco-env.sh
. scripts/lib/deveco-env.sh

JSON_PATH=""
STRICT=0
while [ $# -gt 0 ]; do
  case "$1" in
    --json) JSON_PATH="${2:-}"; shift 2 ;;
    --strict) STRICT=1; shift ;;
    -h | --help) sed -n '2,13p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

ROWS=()
FAILS=0
WARNS=0

json_escape() {
  printf '%s' "${1:-}" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' | tr -d '\000-\010\013\014\016-\037'
}

# record <PASS|WARN|FAIL|INFO> <check-id> <detail>
record() {
  local status="$1" id="$2" detail="${3:-}"
  case "$status" in
    FAIL) FAILS=$((FAILS + 1)) ;;
    WARN) WARNS=$((WARNS + 1)) ;;
  esac
  ROWS+=("$(printf '{"status":"%s","check":"%s","detail":"%s"}' \
    "$(json_escape "$status")" "$(json_escape "$id")" "$(json_escape "$detail")")")
  printf '  %-4s %-26s %s\n' "$status" "$id" "$detail"
}

section() { printf '\n%s\n' "$1"; }

printf 'HermesEye HarmonyOS harness environment\n'
printf 'repository: %s\n' "$(pwd)"
printf 'checked at: %s\n' "$(date '+%Y-%m-%dT%H:%M:%S%z')"

# ---------------------------------------------------------------- host
section 'Host'
HOST_OS="$(uname -s)"
HOST_ARCH="$(uname -m)"
record INFO host "$HOST_OS/$HOST_ARCH"
case "$HOST_OS" in
  Darwin) record PASS platform 'macOS host: bash entry points are supported' ;;
  Linux) record WARN platform 'Linux host: supported by these scripts but untested on this project' ;;
  MINGW* | MSYS* | CYGWIN*) record WARN platform 'Windows host: prefer scripts/build.ps1; the bash entry points are secondary' ;;
  *) record WARN platform "untested host: $HOST_OS" ;;
esac

# ---------------------------------------------------------------- toolchain
section 'DevEco toolchain'
DEVECO_HOME_RESOLVED="$(deveco_resolve || true)"
if [ -z "$DEVECO_HOME_RESOLVED" ]; then
  record FAIL deveco-home 'no usable installation found; set DEVECO_HOME to the dir containing tools/ and sdk/'
  printf '\nCandidates tried:\n'
  deveco_candidates | sed 's/^/  - /'
else
  deveco_export_env "$DEVECO_HOME_RESOLVED"
  record PASS deveco-home "$DEVECO_HOME"

  # Cross-check that the shell and Node resolvers agree, so the .cjs runners and
  # the shell entry points can never silently use different installations.
  shellcheck_node="$(command -v node || true)"
  if [ -n "$shellcheck_node" ]; then
    node_home="$("$DEVECO_NODE" -e \
      "process.stdout.write(require('./scripts/lib/deveco-env.cjs').resolveDevecoHome({required:false}))" \
      2>/dev/null || true)"
    if [ "$node_home" = "$DEVECO_HOME" ]; then
      record PASS resolver-agreement 'shell and Node resolvers agree'
    elif [ -z "$node_home" ]; then
      record WARN resolver-agreement 'Node resolver found nothing (Node runner may fail)'
    else
      record FAIL resolver-agreement "shell=$DEVECO_HOME node=$node_home"
    fi

    ts_ok="$("$DEVECO_NODE" -e \
      "require('./scripts/lib/deveco-env.cjs').loadTypescript();process.stdout.write('ok')" 2>&1 | tail -1)"
    if [ "$ts_ok" = "ok" ]; then
      record PASS bundled-typescript 'hvigor-bundled typescript loads'
    else
      record FAIL bundled-typescript "$ts_ok"
    fi
  else
    record WARN node-path 'node not on PATH; only the DevEco-bundled node is usable'
  fi
fi

if [ -n "${DEVECO_HOME:-}" ]; then
  for pair in \
    "bundled-node:$DEVECO_NODE" \
    "bundled-java:$JAVA_HOME/bin/java" \
    "hvigor:$DEVECO_HVIGORW" \
    "ohpm:$DEVECO_OHPM" \
    "hdc:$DEVECO_HDC" \
    "emulator:$DEVECO_EMULATOR_DIR/Emulator"; do
    id="${pair%%:*}"
    path="${pair#*:}"
    if [ -e "$path" ]; then
      record PASS "$id" "$path"
    else
      case "$id" in
        emulator) record WARN "$id" "missing: $path (device acceptance will need a real device)" ;;
        hdc) record FAIL "$id" "missing: $path" ;;
        *) record FAIL "$id" "missing: $path" ;;
      esac
    fi
  done

  if [ -x "${DEVECO_NODE:-}" ]; then
    record INFO bundled-node-version "$("$DEVECO_NODE" -v 2>/dev/null)"
  fi
  if [ -x "${JAVA_HOME:-}/bin/java" ]; then
    record INFO bundled-java-version "$("$JAVA_HOME/bin/java" -version 2>&1 | head -1)"
  fi
fi

# ---------------------------------------------------------------- SDK
section 'SDK and project target'
SDK_API="$(deveco_sdk_api_version "${DEVECO_HOME:-}" || true)"
SDK_NAME="$(deveco_sdk_display_name "${DEVECO_HOME:-}" || true)"
PROJECT_SDK="$(project_compatible_sdk build-profile.json5 || true)"
PROJECT_API="$(api_level_of "$PROJECT_SDK")"

if [ -n "$SDK_API" ]; then
  record PASS sdk-installed "${SDK_NAME:-unknown} (apiLevel $SDK_API)"
else
  record FAIL sdk-installed 'cannot read sdk/default/sdk-pkg.json'
fi
if [ -n "$PROJECT_SDK" ]; then
  record INFO project-target "compatibleSdkVersion=$PROJECT_SDK (apiLevel ${PROJECT_API:-?})"
else
  record FAIL project-target 'cannot read compatibleSdkVersion from build-profile.json5'
fi
if [ -n "$SDK_API" ] && [ -n "$PROJECT_API" ]; then
  if [ "$SDK_API" -ge "$PROJECT_API" ]; then
    record PASS sdk-target-fit "installed API $SDK_API >= project API $PROJECT_API"
  else
    record FAIL sdk-target-fit "installed API $SDK_API < project API $PROJECT_API; install a newer SDK"
  fi
fi

# ---------------------------------------------------------------- dependencies
section 'Project dependencies'
if [ -d oh_modules ] && [ -n "$(ls -A oh_modules 2>/dev/null)" ]; then
  record PASS oh-modules "oh_modules present ($(ls oh_modules | tr '\n' ' ' | sed 's/ $//'))"
else
  record FAIL oh-modules 'oh_modules missing or empty; run ohpm install'
fi
for suite in domain services workspace; do
  if [ -f "scripts/test-$suite.cjs" ]; then
    record PASS "test-suite:$suite" "scripts/test-$suite.cjs"
  else
    record FAIL "test-suite:$suite" "missing scripts/test-$suite.cjs"
  fi
done

# ---------------------------------------------------------------- signing / device
section 'Signing and device readiness'
if grep -Eq '"signingConfigs"[[:space:]]*:[[:space:]]*\[[[:space:]]*\]' build-profile.json5; then
  record WARN signing-config 'signingConfigs is empty: unsigned HAPs (the emulator accepts them, a real device will not)'
else
  record PASS signing-config 'a signing configuration is declared in build-profile.json5'
fi
MISSING_IGNORES=""
for pattern in '*.p12' '*.cer' '*.p7b' '*.pem'; do
  grep -qF "$pattern" .gitignore 2>/dev/null || MISSING_IGNORES="$MISSING_IGNORES $pattern"
done
if [ -z "$MISSING_IGNORES" ]; then
  record PASS signing-gitignore 'signing material extensions are git-ignored'
else
  record FAIL signing-gitignore "not ignored:$MISSING_IGNORES"
fi

if [ -x "${DEVECO_HDC:-}" ]; then
  targets="$("$DEVECO_HDC" list targets 2>/dev/null | grep -v '^\[Empty\]' | grep -v '^$' | tr '\n' ' ' || true)"
  if [ -n "$targets" ]; then
    record PASS device-connected "hdc targets: $targets"
  else
    record INFO device-connected 'no hdc target; emulator or device acceptance is unavailable right now'
  fi
fi

# ---------------------------------------------------------------- harness assets
section 'Harness assets'
if [ -d .dsh/skills ]; then
  # A skill is <root>/<name>/SKILL.md; nested paths are deliberately not discovered by DSH.
  skills="$(find .dsh/skills -maxdepth 2 -name 'SKILL.md' -type f 2>/dev/null | wc -l | tr -d ' ')"
  names="$(find .dsh/skills -maxdepth 2 -name 'SKILL.md' -type f 2>/dev/null | sed 's|^\.dsh/skills/||; s|/SKILL.md$||' | sort | tr '\n' ' ' | sed 's/ $//')"
  if [ "$skills" -gt 0 ]; then
    record PASS skills-present "$skills skill(s): $names"
  else
    record WARN skills-present '.dsh/skills exists but declares no <name>/SKILL.md'
  fi
else
  record WARN skills-present '.dsh/skills absent: the HarmonyOS skills are not available to agents'
fi
if [ -f code-linter.json5 ]; then
  # The DevEco codelinter CLI is reachable but non-functional (exit 255, opaque error);
  # do not advertise a lint stage the harness cannot actually run.
  if [ -f "${DEVECO_HOME:-}/plugins/codelinter/run/index.js" ]; then
    record WARN code-linter 'code-linter.json5 present; DevEco codelinter CLI exists but fails (exit 255) - run it in the IDE'
  else
    record INFO code-linter 'code-linter.json5 present; no codelinter CLI found - run lint in DevEco Studio'
  fi
else
  record WARN code-linter 'code-linter.json5 missing'
fi

# ---------------------------------------------------------------- summary
section 'Summary'
if [ "$FAILS" -gt 0 ]; then
  printf '  FAILED: %d failure(s), %d warning(s)\n' "$FAILS" "$WARNS"
elif [ "$WARNS" -gt 0 ]; then
  printf '  OK with %d warning(s)\n' "$WARNS"
else
  printf '  OK: every check passed\n'
fi

if [ -n "$JSON_PATH" ]; then
  mkdir -p "$(dirname "$JSON_PATH")"
  {
    printf '{\n'
    printf '  "generatedAt": "%s",\n' "$(date '+%Y-%m-%dT%H:%M:%S%z')"
    printf '  "host": {"os": "%s", "arch": "%s"},\n' "$(json_escape "$HOST_OS")" "$(json_escape "$HOST_ARCH")"
    printf '  "devecoHome": "%s",\n' "$(json_escape "${DEVECO_HOME:-}")"
    printf '  "sdkApiLevel": "%s",\n' "$(json_escape "$SDK_API")"
    printf '  "projectCompatibleSdk": "%s",\n' "$(json_escape "$PROJECT_SDK")"
    printf '  "failures": %d,\n  "warnings": %d,\n' "$FAILS" "$WARNS"
    printf '  "checks": [\n'
    for i in "${!ROWS[@]}"; do
      if [ "$i" -lt "$((${#ROWS[@]} - 1))" ]; then sep=','; else sep=''; fi
      printf '    %s%s\n' "${ROWS[$i]}" "$sep"
    done
    printf '  ]\n}\n'
  } >"$JSON_PATH"
  printf '\nJSON report: %s\n' "$JSON_PATH"
fi

[ "$FAILS" -gt 0 ] && exit 1
[ "$STRICT" -eq 1 ] && [ "$WARNS" -gt 0 ] && exit 1
exit 0
