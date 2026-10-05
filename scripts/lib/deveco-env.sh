#!/usr/bin/env bash
# Shared DevEco Studio environment resolution for the shell entry points.
#
# Usage: source this file, then call deveco_resolve / deveco_export_env.
# Do not execute directly.
#
# Keep the candidate list in sync with scripts/lib/deveco-env.cjs; scripts/doctor.sh
# cross-checks that both resolvers agree on the same installation.
#
# An installation root is the directory containing tools/ and sdk/.
# On macOS that is DevEco-Studio.app/Contents.

# Print candidate installation roots, best first.
deveco_candidates() {
  local list=()
  if [ -n "${DEVECO_HOME:-}" ]; then list+=("$DEVECO_HOME"); fi
  case "$(uname -s)" in
    Darwin)
      list+=("/Applications/DevEco-Studio.app/Contents")
      list+=("$HOME/Applications/DevEco-Studio.app/Contents")
      ;;
    Linux)
      list+=("$HOME/DevEco-Studio" "/opt/deveco-studio")
      ;;
    MINGW* | MSYS* | CYGWIN*)
      list+=("/d/dev-tools/DevEco Studio" "/c/Program Files/Huawei/DevEco Studio")
      ;;
  esac
  printf '%s\n' "${list[@]}"
}

# A usable installation has the hvigor toolchain and the bundled SDK.
deveco_is_usable() {
  local home="${1:-}"
  [ -n "$home" ] && [ -d "$home/tools/hvigor" ] && [ -d "$home/sdk" ]
}

# Print the first usable installation root; non-zero when none is found.
deveco_resolve() {
  local home
  while IFS= read -r home; do
    if deveco_is_usable "$home"; then
      printf '%s' "$home"
      return 0
    fi
  done < <(deveco_candidates)
  return 1
}

# Export every DEVECO_* variable the build and test entry points rely on.
# Java lives under jbr/Contents/Home on macOS and jbr/ elsewhere.
deveco_export_env() {
  local home="$1"
  DEVECO_HOME="$home"
  DEVECO_SDK_HOME="${DEVECO_SDK_HOME:-$home/sdk}"
  case "$(uname -s)" in
    Darwin) JAVA_HOME="${JAVA_HOME:-$home/jbr/Contents/Home}" ;;
    *) JAVA_HOME="${JAVA_HOME:-$home/jbr}" ;;
  esac
  DEVECO_NODE="$home/tools/node/bin/node"
  DEVECO_HVIGORW="$home/tools/hvigor/bin/hvigorw.js"
  DEVECO_HDC="$home/sdk/default/openharmony/toolchains/hdc"
  DEVECO_OHPM="$home/tools/ohpm/bin/ohpm"
  DEVECO_EMULATOR_DIR="$home/tools/emulator"
  export DEVECO_HOME DEVECO_SDK_HOME JAVA_HOME
  export DEVECO_NODE DEVECO_HVIGORW DEVECO_HDC DEVECO_OHPM DEVECO_EMULATOR_DIR
}

# Print the apiVersion of the installed SDK (e.g. 26); empty when unreadable.
deveco_sdk_api_version() {
  local home="${1:-${DEVECO_HOME:-}}"
  local meta="$home/sdk/default/sdk-pkg.json"
  [ -f "$meta" ] || return 1
  sed -n 's/.*"apiVersion"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$meta" | head -1
}

# Print the displayName of the installed SDK (e.g. HarmonyOS 26.0.0).
deveco_sdk_display_name() {
  local home="${1:-${DEVECO_HOME:-}}"
  local meta="$home/sdk/default/sdk-pkg.json"
  [ -f "$meta" ] || return 1
  sed -n 's/.*"displayName"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$meta" | head -1
}

# Print the compatibleSdkVersion declared in build-profile.json5 (e.g. 6.1.1(24)).
project_compatible_sdk() {
  local profile="${1:-build-profile.json5}"
  [ -f "$profile" ] || return 1
  sed -n 's/.*"compatibleSdkVersion"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$profile" | head -1
}

# Extract the numeric API level from a version string such as "6.1.1(24)".
api_level_of() {
  printf '%s' "${1:-}" | sed -n 's/.*(\([0-9][0-9]*\)).*/\1/p'
}
