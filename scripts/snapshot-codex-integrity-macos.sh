#!/bin/bash
set -euo pipefail

readonly PK_SNAPSHOT_SCRIPT_DIR="$(cd "$(/usr/bin/dirname "${BASH_SOURCE[0]}")" && pwd -P)"
source "$PK_SNAPSHOT_SCRIPT_DIR/common-macos.sh"

pk_snapshot_bundle_value() {
  local app_path="$1" key="$2"
  /usr/libexec/PlistBuddy -c "Print :$key" "$app_path/Contents/Info.plist" 2>/dev/null
}

pk_snapshot_architecture() {
  local app_path="$1" executable
  executable="$(pk_snapshot_bundle_value "$app_path" CFBundleExecutable)" || return 1
  /usr/bin/file -b "$app_path/Contents/MacOS/$executable"
}

pk_snapshot_codesign_details() {
  pk_codesign -dv --verbose=4 "$1" 2>&1
}

pk_snapshot_requirement() {
  pk_codesign -d -r- "$1" 2>&1 | /usr/bin/sed -n '/^designated =>/p'
}

pk_snapshot_codesign_integrity() {
  pk_codesign --verify --deep --strict "$1" >/dev/null 2>&1
}

pk_write_integrity_snapshot() {
  local output="$1" app_path="$2" identifier="$3" short_version="$4" bundle_version="$5"
  local executable="$6" architecture="$7" details="$8" requirement="$9" codesign_valid="${10}" official_valid="${11}"
  "$PK_NODE" --input-type=module - "$output" "$app_path" "$identifier" "$short_version" \
    "$bundle_version" "$executable" "$architecture" "$details" "$requirement" \
    "$codesign_valid" "$official_valid" <<'NODE'
import { createHash } from "node:crypto";
import fs from "node:fs";

const [
  output, bundlePath, bundleIdentifier, version, buildVersion, executable,
  architecture, signingDetails, designatedRequirement, codesignValid,
  officialSignatureValid
] = process.argv.slice(2);
const field = (name) => signingDetails.split(/\r?\n/u)
  .find((line) => line.startsWith(`${name}=`))?.slice(name.length + 1) ?? null;
const cdHash = field("CDHash");
const teamIdentifier = field("TeamIdentifier");
const immutableFields = {
  bundleIdentifier,
  version,
  buildVersion,
  executable,
  architecture,
  designatedRequirement,
  cdHash,
  teamIdentifier
};
const immutableDigest = createHash("sha256")
  .update(JSON.stringify(immutableFields))
  .digest("hex");
const result = {
  bundlePath,
  bundleIdentifier,
  version,
  buildVersion,
  executable,
  architecture,
  codesignValid: codesignValid === "true",
  officialSignatureValid: officialSignatureValid === "true",
  cdHash,
  teamIdentifier,
  designatedRequirement,
  immutableDigest
};
fs.writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
NODE
}

snapshot_main() {
  if [[ "$#" -ne 1 ]]; then
    pk_error "usage: snapshot-codex-integrity-macos.sh <output.json>"
    return 1
  fi
  pk_initialize_paths "${BASH_SOURCE[0]}" || return $?
  pk_require_supported_environment || return $?

  local requested_output="$1" output_parent output_name output temporary app_path
  local identifier short_version bundle_version executable architecture details requirement
  local codesign_valid=false official_valid=false
  [[ "$requested_output" == /* && "$requested_output" != *$'\n'* && "$requested_output" != *$'\r'* ]] || {
    pk_error "snapshot output must be an absolute path"
    return 1
  }
  if [[ -L "$requested_output" ]]; then
    pk_error "snapshot output must not be a symlink"
    return 1
  fi
  output_parent="$(/usr/bin/dirname "$requested_output")"
  output_name="$(/usr/bin/basename "$requested_output")"
  [[ "$output_name" != "." && "$output_name" != ".." && "$output_name" != */* ]] || return 1
  /bin/mkdir -p "$output_parent" || return 1
  output_parent="$(cd "$output_parent" 2>/dev/null && pwd -P)" || return 1
  output="$output_parent/$output_name"

  app_path="$(pk_discover_codex_app)" || return 1
  case "$output" in
    "$app_path"|"$app_path"/*)
      pk_error "snapshot output must remain outside the application bundle"
      return 1
      ;;
  esac
  identifier="$(pk_snapshot_bundle_value "$app_path" CFBundleIdentifier)" || return 1
  [[ "$identifier" == "$PK_EXPECTED_BUNDLE_ID" ]] || return 1
  short_version="$(pk_snapshot_bundle_value "$app_path" CFBundleShortVersionString)" || return 1
  bundle_version="$(pk_snapshot_bundle_value "$app_path" CFBundleVersion)" || return 1
  executable="$(pk_snapshot_bundle_value "$app_path" CFBundleExecutable)" || return 1
  architecture="$(pk_snapshot_architecture "$app_path")" || return 1
  details="$(pk_snapshot_codesign_details "$app_path")" || return 1
  requirement="$(pk_snapshot_requirement "$app_path")" || return 1
  [[ -n "$requirement" ]] || return 1
  if pk_snapshot_codesign_integrity "$app_path"; then
    codesign_valid=true
  fi
  if pk_verify_codex_signature "$app_path"; then
    official_valid=true
  fi

  temporary="$(/usr/bin/mktemp "$output_parent/.prime-knight-integrity.XXXXXX")" || return 1
  if ! pk_write_integrity_snapshot "$temporary" "$app_path" "$identifier" "$short_version" \
    "$bundle_version" "$executable" "$architecture" "$details" "$requirement" \
    "$codesign_valid" "$official_valid"; then
    /bin/rm -f "$temporary"
    return 1
  fi
  /bin/mv -f "$temporary" "$output" || {
    /bin/rm -f "$temporary"
    return 1
  }
  printf 'Prime Knight Codex integrity snapshot: %s\n' "$output"
  [[ "$codesign_valid" == true && "$official_valid" == true ]]
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  if snapshot_main "$@"; then
    exit 0
  else
    status=$?
    [[ "$status" -eq 2 ]] && exit 2
    exit 1
  fi
fi
