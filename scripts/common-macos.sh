#!/bin/bash

unset PK_HOME PK_SOURCE_ROOT PK_INSTALL_DIR PK_STATE_DIR PK_PROFILE_DIR PK_LAUNCH_AGENTS_DIR PK_LAUNCH_AGENT_PLIST PK_NODE PK_NODE_MAJOR PK_NODE_MINOR PK_NODE_PATCH PK_NODE_CDP_FLAG PK_ARCHITECTURE 2>/dev/null || true
umask 077

readonly PK_OWNER_VALUE="codex-prime-knight-theme:v1"
readonly PK_EXPECTED_BUNDLE_ID="com.openai.codex"
readonly PK_EXPECTED_SIGNER_NAMES=("OpenAI, L.L.C." "OpenAI OpCo, LLC")
readonly PK_LOOPBACK="127.0.0.1"
readonly PK_MIN_PORT=9341
readonly PK_MAX_PORT=9399
readonly PK_LAUNCH_AGENT_LABEL="io.github.codex-prime-knight.theme-watcher"

pk_error() {
  printf 'Prime Knight: %s\n' "$*" >&2
  return 1
}

pk_unsupported() {
  printf 'Prime Knight: %s\n' "$*" >&2
  return 2
}

pk_reject_args() {
  if [[ "$1" -ne 0 ]]; then
    pk_error "this entry point does not accept parameters"
    return 1
  fi
}

pk_validate_home() {
  if [[ -n "${PK_HOME:-}" ]]; then
    return 0
  fi
  if [[ -z "${HOME:-}" || "$HOME" != /* || "$HOME" == "/" || "$HOME" == *$'\n'* || "$HOME" == *$'\r'* ]]; then
    pk_error "HOME must be an absolute, non-root directory"
    return 1
  fi
  if [[ ! -d "$HOME" || ! -O "$HOME" ]]; then
    pk_error "HOME must exist and be owned by the current user"
    return 1
  fi
  local resolved_home
  resolved_home="$(cd "$HOME" 2>/dev/null && pwd -P)" || {
    pk_error "HOME cannot be resolved"
    return 1
  }
  if [[ "$resolved_home" == "/" ]]; then
    pk_error "HOME resolved to the filesystem root"
    return 1
  fi
  PK_HOME="$resolved_home"
}

pk_initialize_paths() {
  local script_path="$1" script_directory
  script_directory="$(cd "$(/usr/bin/dirname "$script_path")" 2>/dev/null && pwd -P)" || {
    pk_error "script directory cannot be resolved"
    return 1
  }
  PK_SOURCE_ROOT="$(cd "$script_directory/.." 2>/dev/null && pwd -P)" || {
    pk_error "source directory cannot be resolved"
    return 1
  }
  pk_validate_home || return $?
  PK_INSTALL_DIR="$PK_HOME/Library/Application Support/Codex Prime Knight Theme"
  PK_STATE_DIR="$PK_INSTALL_DIR/.state"
  PK_PROFILE_DIR="$PK_INSTALL_DIR/.profile"
  PK_LAUNCH_AGENTS_DIR="$PK_HOME/Library/LaunchAgents"
  PK_LAUNCH_AGENT_PLIST="$PK_LAUNCH_AGENTS_DIR/$PK_LAUNCH_AGENT_LABEL.plist"
  readonly PK_HOME PK_SOURCE_ROOT PK_INSTALL_DIR PK_STATE_DIR PK_PROFILE_DIR PK_LAUNCH_AGENTS_DIR PK_LAUNCH_AGENT_PLIST
}

pk_node_binary() {
  command -v node 2>/dev/null
}

pk_require_node() {
  local node_binary version major minor patch
  node_binary="$(pk_node_binary)" || {
    pk_unsupported "Node 20.10 or newer is required"
    return 2
  }
  if [[ ! -x "$node_binary" ]]; then
    pk_unsupported "Node 20.10 or newer is required"
    return 2
  fi
  version="$("$node_binary" -p 'process.versions.node' 2>/dev/null)" || {
    pk_unsupported "Node 20.10 or newer is required"
    return 2
  }
  if [[ ! "$version" =~ ^([0-9]+)\.([0-9]+)\.([0-9]+)$ ]]; then
    pk_unsupported "Node 20.10 or newer is required (found ${version:-unknown})"
    return 2
  fi
  major="${BASH_REMATCH[1]}"
  minor="${BASH_REMATCH[2]}"
  patch="${BASH_REMATCH[3]}"
  if [[ "$major" -lt 20 || ( "$major" -eq 20 && "$minor" -lt 10 ) ]]; then
    pk_unsupported "Node 20.10 or newer is required (found ${version:-unknown})"
    return 2
  fi
  PK_NODE="$node_binary"
  PK_NODE_MAJOR="$major"
  PK_NODE_MINOR="$minor"
  PK_NODE_PATCH="$patch"
}

pk_run_cdp_node() {
  if [[ -n "${PK_NODE_CDP_FLAG:-}" ]]; then
    "$PK_NODE" "$PK_NODE_CDP_FLAG" "$@"
  else
    "$PK_NODE" "$@"
  fi
}

pk_require_cdp_capability() {
  if [[ -z "${PK_NODE:-}" || -z "${PK_NODE_MAJOR:-}" || -z "${PK_NODE_MINOR:-}" ]]; then
    pk_require_node || return $?
  fi
  if [[ "$PK_NODE_MAJOR" -eq 20 && "$PK_NODE_MINOR" -lt 10 ]]; then
    pk_unsupported "Node 20.10 or newer with fetch and WebSocket support is required"
    return 2
  fi
  if [[ "$PK_NODE_MAJOR" -eq 20 || "$PK_NODE_MAJOR" -eq 21 ]]; then
    PK_NODE_CDP_FLAG="--experimental-websocket"
  else
    PK_NODE_CDP_FLAG=""
  fi
  if ! pk_run_cdp_node -e '
    if (typeof fetch !== "function" || typeof WebSocket !== "function") process.exit(1);
    (async () => {
      const response = await fetch("data:text/plain,prime-knight");
      if (!response.ok || await response.text() !== "prime-knight") process.exit(1);
      await new Promise((resolve, reject) => {
        const socket = new WebSocket("ws://127.0.0.1:1");
        const timeout = setTimeout(() => reject(new Error("WebSocket probe timed out")), 1000);
        socket.addEventListener("open", () => { clearTimeout(timeout); socket.close(); resolve(); }, { once: true });
        socket.addEventListener("error", () => { clearTimeout(timeout); resolve(); }, { once: true });
      });
    })().catch(() => process.exit(1));
  ' >/dev/null 2>&1; then
    pk_unsupported "this Node runtime does not provide usable fetch and WebSocket support"
    return 2
  fi
}

pk_verify_package_metadata() {
  local root="$1"
  if ! "$PK_NODE" -e '
    const fs = require("node:fs");
    const path = require("node:path");
    const pkg = JSON.parse(fs.readFileSync(path.join(process.argv[1], "package.json"), "utf8"));
    if (pkg.name !== "codex-prime-knight-theme") process.exit(1);
    if (typeof pkg.version !== "string" || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(pkg.version)) process.exit(1);
    if (pkg.engines?.node !== ">=20.10.0") process.exit(1);
  ' "$root" >/dev/null 2>&1; then
    pk_error "package version or Node engine metadata is invalid"
    return 1
  fi
}

pk_require_supported_environment() {
  local system architecture
  system="$(/usr/bin/uname -s 2>/dev/null)" || system=""
  if [[ "$system" != "Darwin" ]]; then
    pk_unsupported "macOS is required"
    return 2
  fi
  architecture="$(/usr/bin/uname -m 2>/dev/null)" || architecture=""
  case "$architecture" in
    arm64|x86_64) ;;
    *)
      pk_unsupported "unsupported Mac architecture: ${architecture:-unknown}"
      return 2
      ;;
  esac
  pk_validate_home || return $?
  pk_require_node || return $?
  PK_ARCHITECTURE="$architecture"
}

pk_bundle_identifier() {
  local app_path="$1"
  /usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$app_path/Contents/Info.plist" 2>/dev/null
}

pk_candidate_is_codex() {
  local app_path="$1" bundle_id
  [[ -d "$app_path" && ! -L "$app_path" ]] || return 1
  bundle_id="$(pk_bundle_identifier "$app_path")" || return 1
  [[ "$bundle_id" == "$PK_EXPECTED_BUNDLE_ID" ]]
}

pk_discover_codex_app() {
  local candidate saw_candidate=0
  for candidate in "/Applications/Codex.app" "/Applications/ChatGPT.app" \
    "$PK_HOME/Applications/Codex.app" "$PK_HOME/Applications/ChatGPT.app"; do
    if [[ -e "$candidate" ]]; then
      saw_candidate=1
      if pk_candidate_is_codex "$candidate"; then
        printf '%s\n' "$candidate"
        return 0
      fi
    fi
  done
  if [[ -x /usr/bin/mdfind ]]; then
    while IFS= read -r candidate; do
      [[ -n "$candidate" && "$candidate" != *$'\n'* && "$candidate" != *$'\r'* ]] || continue
      saw_candidate=1
      if pk_candidate_is_codex "$candidate"; then
        printf '%s\n' "$candidate"
        return 0
      fi
    done < <(/usr/bin/mdfind "kMDItemCFBundleIdentifier == '$PK_EXPECTED_BUNDLE_ID'" 2>/dev/null)
  fi
  if [[ "$saw_candidate" -eq 1 ]]; then
    pk_error "Codex bundle identifier did not match $PK_EXPECTED_BUNDLE_ID"
  else
    pk_error "Codex.app was not found"
  fi
}

pk_codesign() {
  /usr/bin/codesign "$@"
}

pk_gatekeeper_assess() {
  /usr/sbin/spctl "$@" 2>&1
}

pk_signing_field() {
  local output="$1" field="$2"
  printf '%s\n' "$output" | /usr/bin/awk -v prefix="$field=" '
    index($0, prefix) == 1 { print substr($0, length(prefix) + 1) }
  '
}

pk_output_has_exact_line() {
  printf '%s\n' "$1" | /usr/bin/grep -Fqx -- "$2"
}

pk_verify_codex_signature() {
  local app_path="$1" details requirement assessment identifier team authority expected_authority expected_origin expected_signer
  local authorized=0 signer
  if ! pk_codesign --verify --deep --strict "$app_path" >/dev/null 2>&1; then
    pk_error "Codex application signature verification failed"
    return 1
  fi
  details="$(pk_codesign -dv --verbose=4 "$app_path" 2>&1)" || {
    pk_error "Codex signing authority could not be read"
    return 1
  }
  identifier="$(pk_signing_field "$details" "Identifier")"
  team="$(pk_signing_field "$details" "TeamIdentifier")"
  authority="$(pk_signing_field "$details" "Authority" | /usr/bin/sed -n '1p')"
  for signer in "${PK_EXPECTED_SIGNER_NAMES[@]}"; do
    expected_authority="Developer ID Application: ${signer} (${team})"
    if [[ "$authority" == "$expected_authority" ]]; then
      authorized=1
      expected_signer="$signer"
      break
    fi
  done
  if [[ "$identifier" != "$PK_EXPECTED_BUNDLE_ID" || ! "$team" =~ ^[A-Z0-9]{10}$ || "$authorized" -ne 1 ]] ||
     pk_output_has_exact_line "$details" "Signature=adhoc" ||
     ! pk_output_has_exact_line "$details" "Authority=Developer ID Certification Authority" ||
     ! pk_output_has_exact_line "$details" "Authority=Apple Root CA"; then
    pk_error "Codex publisher signature is not the expected OpenAI Developer ID"
    return 1
  fi

  requirement="$(pk_codesign -d -r- "$app_path" 2>&1)" || {
    pk_error "Codex designated signature requirement could not be read"
    return 1
  }
  case "$requirement" in
    *"identifier \"$PK_EXPECTED_BUNDLE_ID\""*"anchor apple generic"*) ;;
    *)
      pk_error "Codex designated signature requirement is invalid"
      return 1
      ;;
  esac
  case "$requirement" in
    *"certificate leaf[subject.OU] = $team"|*"certificate leaf[subject.OU] = \"$team\"") ;;
    *)
      pk_error "Codex designated signature TeamIdentifier is inconsistent"
      return 1
      ;;
  esac

  assessment="$(pk_gatekeeper_assess -a -vv --type execute "$app_path" 2>&1)" || {
    pk_error "Codex Gatekeeper assessment failed"
    return 1
  }
  expected_origin="origin=Developer ID Application: $expected_signer ($team)"
  if ! pk_output_has_exact_line "$assessment" "source=Notarized Developer ID" ||
     ! pk_output_has_exact_line "$assessment" "$expected_origin" ||
     ! printf '%s\n' "$assessment" | /usr/bin/awk 'NR == 1 && /: accepted$/ { found=1 } END { exit(found ? 0 : 1) }'; then
    pk_error "Codex Gatekeeper notarization or publisher evidence is invalid"
    return 1
  fi
}

pk_valid_port() {
  [[ "$1" =~ ^[0-9]+$ && "$1" -ge "$PK_MIN_PORT" && "$1" -le "$PK_MAX_PORT" ]]
}

pk_port_in_use() {
  /usr/sbin/lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
}

pk_choose_port() {
  local port
  for ((port=PK_MIN_PORT; port<=PK_MAX_PORT; port+=1)); do
    if ! pk_port_in_use "$port"; then
      printf '%s\n' "$port"
      return 0
    fi
  done
  pk_error "no loopback debugging port is available in $PK_MIN_PORT..$PK_MAX_PORT"
}

pk_owned_relative_paths() {
  local hour frame
  printf '%s\n' \
    "package.json" \
    "config/backgrounds.json" \
    "src/background/clock.mjs" \
    "src/background/manifest.mjs" \
    "src/background/presentation.mjs" \
    "src/background/rotator.mjs" \
    "src/runtime/injector.mjs" \
    "src/runtime/payload.mjs" \
    "src/runtime/watcher.mjs" \
    "src/theme/cockpit-layout.mjs" \
    "src/theme/install-theme.mjs" \
    "src/theme/prime-knight.css" \
    "scripts/lib/webp-dimensions.mjs" \
    "scripts/verify-backgrounds.mjs" \
    "scripts/common-macos.sh" \
    "scripts/install-macos.sh" \
    "scripts/start-macos.sh" \
    "scripts/verify-macos.sh" \
    "scripts/restore-macos.sh" \
    "Install Prime Knight Theme.command" \
    "Start Prime Knight Theme.command" \
    "Verify Prime Knight Theme.command" \
    "Restore Native Codex.command"
  for ((hour=0; hour<24; hour+=1)); do
    printf 'assets/backgrounds/%02d.webp\n' "$hour"
  done
  for frame in corner-tl corner-tr corner-bl corner-br edge-h edge-v divider-v divider-v-top divider-v-bottom divider-h divider-h-left divider-h-right energy-core chamber-sidebar chamber-main chamber-composer; do
    printf 'assets/frame/%s.webp\n' "$frame"
  done
}

pk_launchctl() {
  /bin/launchctl "$@"
}

pk_plist_value() {
  local key="$1" plist="$2"
  /usr/libexec/PlistBuddy -c "Print :$key" "$plist" 2>/dev/null
}

pk_validate_owned_launch_agent() {
  local plist="${1:-$PK_LAUNCH_AGENT_PLIST}" arg_index=1 watcher root port token ready extra stdout_path stderr_path mode
  [[ "$plist" == "$PK_LAUNCH_AGENT_PLIST" ]] || return 1
  [[ -f "$plist" && ! -L "$plist" && -O "$plist" ]] || return 1
  mode="$(/usr/bin/stat -f '%Lp' "$plist" 2>/dev/null)" || return 1
  [[ "$mode" == "600" ]] || return 1
  /usr/bin/plutil -lint "$plist" >/dev/null 2>&1 || return 1
  [[ "$(pk_plist_value Label "$plist")" == "$PK_LAUNCH_AGENT_LABEL" ]] || return 1
  [[ "$(pk_plist_value RunAtLoad "$plist")" == "true" ]] || return 1
  [[ "$(pk_plist_value KeepAlive "$plist")" == "true" ]] || return 1
  [[ "$(pk_plist_value ProcessType "$plist")" == "Background" ]] || return 1
  if [[ "$(pk_plist_value ProgramArguments:1 "$plist")" == "--experimental-websocket" ]]; then
    arg_index=2
  fi
  watcher="$(pk_plist_value "ProgramArguments:$arg_index" "$plist")" || return 1
  root="$(pk_plist_value "ProgramArguments:$((arg_index + 1))" "$plist")" || return 1
  port="$(pk_plist_value "ProgramArguments:$((arg_index + 2))" "$plist")" || return 1
  token="$(pk_plist_value "ProgramArguments:$((arg_index + 3))" "$plist")" || return 1
  ready="$(pk_plist_value "ProgramArguments:$((arg_index + 4))" "$plist")" || return 1
  extra="$(pk_plist_value "ProgramArguments:$((arg_index + 5))" "$plist" 2>/dev/null)" || extra=""
  stdout_path="$(pk_plist_value StandardOutPath "$plist")" || return 1
  stderr_path="$(pk_plist_value StandardErrorPath "$plist")" || return 1
  [[ "$(pk_plist_value ProgramArguments:0 "$plist")" == /*/node ]] || return 1
  [[ "$watcher" == "$PK_INSTALL_DIR/src/runtime/watcher.mjs" && "$root" == "$PK_INSTALL_DIR" ]] || return 1
  pk_valid_port "$port" || return 1
  [[ "$token" =~ ^--prime-knight-token=[a-f0-9]{32}$ ]] || return 1
  [[ "$ready" == "$PK_STATE_DIR/ready" && -z "$extra" ]] || return 1
  [[ "$stdout_path" == "$PK_STATE_DIR/watcher.log" && "$stderr_path" == "$PK_STATE_DIR/watcher.log" ]]
}

pk_write_launch_agent() {
  local port="$1" token="$2" temporary index=0 watcher ready log value
  pk_valid_port "$port" || return 1
  [[ "$token" =~ ^[a-f0-9]{32}$ ]] || return 1
  [[ -n "${PK_NODE:-}" && "$PK_NODE" == /* && -x "$PK_NODE" ]] || return 1
  watcher="$PK_INSTALL_DIR/src/runtime/watcher.mjs"
  ready="$PK_STATE_DIR/ready"
  log="$PK_STATE_DIR/watcher.log"
  [[ -f "$watcher" && ! -L "$watcher" ]] || return 1
  pk_refuse_symlink_components "$PK_HOME" "$PK_LAUNCH_AGENTS_DIR" || return 1
  pk_refuse_symlink_components "$PK_INSTALL_DIR" "$PK_STATE_DIR" || return 1
  /bin/mkdir -p "$PK_LAUNCH_AGENTS_DIR" "$PK_STATE_DIR"
  [[ -d "$PK_LAUNCH_AGENTS_DIR" && ! -L "$PK_LAUNCH_AGENTS_DIR" && -O "$PK_LAUNCH_AGENTS_DIR" ]] || return 1
  [[ ! -e "$PK_LAUNCH_AGENT_PLIST" && ! -L "$PK_LAUNCH_AGENT_PLIST" ]] || return 1
  temporary="$(/usr/bin/mktemp "$PK_LAUNCH_AGENTS_DIR/.$PK_LAUNCH_AGENT_LABEL.XXXXXX")" || return 1
  if ! /usr/bin/plutil -create xml1 "$temporary" ||
     ! /usr/bin/plutil -insert Label -string "$PK_LAUNCH_AGENT_LABEL" "$temporary" ||
     ! /usr/bin/plutil -insert ProgramArguments -json '[]' "$temporary"; then
    /bin/rm -f "$temporary"
    return 1
  fi
  /usr/bin/plutil -insert "ProgramArguments.$index" -string "$PK_NODE" "$temporary" || { /bin/rm -f "$temporary"; return 1; }
  index=$((index + 1))
  if [[ -n "${PK_NODE_CDP_FLAG:-}" ]]; then
    [[ "$PK_NODE_CDP_FLAG" == "--experimental-websocket" ]] || { /bin/rm -f "$temporary"; return 1; }
    /usr/bin/plutil -insert "ProgramArguments.$index" -string "$PK_NODE_CDP_FLAG" "$temporary" || { /bin/rm -f "$temporary"; return 1; }
    index=$((index + 1))
  fi
  for value in "$watcher" "$PK_INSTALL_DIR" "$port" "--prime-knight-token=$token" "$ready"; do
    /usr/bin/plutil -insert "ProgramArguments.$index" -string "$value" "$temporary" || { /bin/rm -f "$temporary"; return 1; }
    index=$((index + 1))
  done
  if ! /usr/bin/plutil -insert RunAtLoad -bool true "$temporary" ||
     ! /usr/bin/plutil -insert KeepAlive -bool true "$temporary" ||
     ! /usr/bin/plutil -insert ProcessType -string Background "$temporary" ||
     ! /usr/bin/plutil -insert StandardOutPath -string "$log" "$temporary" ||
     ! /usr/bin/plutil -insert StandardErrorPath -string "$log" "$temporary" ||
     ! /bin/chmod 600 "$temporary" ||
     ! /usr/bin/plutil -lint "$temporary" >/dev/null 2>&1 ||
     ! /bin/mv "$temporary" "$PK_LAUNCH_AGENT_PLIST"; then
    /bin/rm -f "$temporary"
    return 1
  fi
  pk_validate_owned_launch_agent
}

pk_bootstrap_launch_agent() {
  local uid domain service
  pk_validate_owned_launch_agent || return 1
  uid="$(/usr/bin/id -u)" || return 1
  domain="gui/$uid"
  service="$domain/$PK_LAUNCH_AGENT_LABEL"
  pk_launchctl bootstrap "$domain" "$PK_LAUNCH_AGENT_PLIST" || return 1
  pk_launchctl kickstart -k "$service"
}

pk_launch_agent_pid() {
  local uid output pid
  uid="$(/usr/bin/id -u)" || return 1
  output="$(pk_launchctl print "gui/$uid/$PK_LAUNCH_AGENT_LABEL" 2>/dev/null)" || return 1
  pid="$(printf '%s\n' "$output" | /usr/bin/awk '$1 == "pid" && $2 == "=" && $3 ~ /^[1-9][0-9]*$/ { print $3; exit }')"
  [[ "$pid" =~ ^[1-9][0-9]*$ ]] || return 1
  printf '%s\n' "$pid"
}

pk_bootout_launch_agent() {
  local uid service attempt
  [[ -e "$PK_LAUNCH_AGENT_PLIST" || -L "$PK_LAUNCH_AGENT_PLIST" ]] || return 0
  pk_validate_owned_launch_agent || return 1
  uid="$(/usr/bin/id -u)" || return 1
  service="gui/$uid/$PK_LAUNCH_AGENT_LABEL"
  if ! pk_launchctl print "$service" >/dev/null 2>&1; then
    return 0
  fi
  pk_launchctl bootout "$service" || return 1
  for ((attempt=0; attempt<50; attempt+=1)); do
    pk_launchctl print "$service" >/dev/null 2>&1 || return 0
    /bin/sleep 0.1
  done
  return 1
}

pk_remove_owned_launch_agent() {
  [[ -e "$PK_LAUNCH_AGENT_PLIST" || -L "$PK_LAUNCH_AGENT_PLIST" ]] || return 0
  pk_validate_owned_launch_agent || return 1
  /bin/rm -f "$PK_LAUNCH_AGENT_PLIST"
}

pk_sha256() {
  /usr/bin/shasum -a 256 "$1" | /usr/bin/awk '{print $1}'
}

pk_refuse_symlink_components() {
  local root="$1" target="$2" relative component current old_ifs
  [[ "$target" == "$root"/* ]] || {
    pk_error "path escaped the owned installation directory"
    return 1
  }
  relative="${target#"$root"/}"
  current="$root"
  old_ifs="$IFS"
  IFS='/'
  for component in $relative; do
    current="$current/$component"
    if [[ -L "$current" ]]; then
      IFS="$old_ifs"
      pk_error "refusing symlink inside owned installation path: $current"
      return 1
    fi
  done
  IFS="$old_ifs"
}

pk_installation_is_owned() {
  [[ -d "$PK_INSTALL_DIR" && ! -L "$PK_INSTALL_DIR" && -O "$PK_INSTALL_DIR" ]] || return 1
  [[ -f "$PK_INSTALL_DIR/.prime-knight-owner" && ! -L "$PK_INSTALL_DIR/.prime-knight-owner" && -O "$PK_INSTALL_DIR/.prime-knight-owner" ]] || return 1
  [[ "$(<"$PK_INSTALL_DIR/.prime-knight-owner")" == "$PK_OWNER_VALUE" ]]
}

pk_assert_install_boundary() {
  local relative
  if [[ -e "$PK_INSTALL_DIR" || -L "$PK_INSTALL_DIR" ]]; then
    if ! pk_installation_is_owned; then
      pk_error "installation directory exists without the Prime Knight ownership marker"
      return 1
    fi
    while IFS= read -r relative; do
      pk_refuse_symlink_components "$PK_INSTALL_DIR" "$PK_INSTALL_DIR/$relative" || return $?
    done < <(pk_owned_relative_paths)
    if [[ -L "$PK_INSTALL_DIR/.install-manifest.sha256" ]]; then
      pk_error "installation checksum manifest must not be a symlink"
      return 1
    fi
  fi
}

pk_require_installation() {
  if ! pk_installation_is_owned; then
    pk_error "Prime Knight theme is not installed or its ownership marker is invalid"
    return 1
  fi
}

pk_validate_owned_files() {
  local root="$1" relative file_path
  while IFS= read -r relative; do
    file_path="$root/$relative"
    pk_refuse_symlink_components "$root" "$file_path" || return $?
    if [[ ! -f "$file_path" || -L "$file_path" ]]; then
      pk_error "required owned file is missing or unsafe: $relative"
      return 1
    fi
  done < <(pk_owned_relative_paths)
}

pk_write_install_manifest() {
  local root="$1" output="$2" relative checksum
  : > "$output"
  while IFS= read -r relative; do
    checksum="$(pk_sha256 "$root/$relative")" || return 1
    printf '%s  %s\n' "$checksum" "$relative" >> "$output"
  done < <(pk_owned_relative_paths)
}

pk_verify_installation_manifest() {
  pk_require_installation || return $?
  pk_validate_owned_files "$PK_INSTALL_DIR" || return $?
  local manifest="$PK_INSTALL_DIR/.install-manifest.sha256"
  if [[ ! -f "$manifest" || -L "$manifest" ]]; then
    pk_error "installation checksum manifest is missing or unsafe"
    return 1
  fi
  local generated
  generated="$(/usr/bin/mktemp "$PK_INSTALL_DIR/.manifest-check.XXXXXX")" || return 1
  if ! pk_write_install_manifest "$PK_INSTALL_DIR" "$generated"; then
    /bin/rm -f "$generated"
    pk_error "could not calculate installation checksums"
    return 1
  fi
  if ! /usr/bin/cmp -s "$manifest" "$generated"; then
    /bin/rm -f "$generated"
    pk_error "installation checksum verification failed"
    return 1
  fi
  /bin/rm -f "$generated"
}

pk_process_start() {
  /bin/ps -o lstart= -p "$1" 2>/dev/null | /usr/bin/sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//'
}

pk_process_command() {
  /bin/ps -o command= -p "$1" 2>/dev/null
}

pk_process_uid() {
  /bin/ps -o uid= -p "$1" 2>/dev/null | /usr/bin/tr -d '[:space:]'
}

pk_process_alive() {
  /bin/kill -0 "$1" 2>/dev/null
}

pk_signal_process() {
  local signal="$1" pid="$2"
  case "$signal" in
    TERM|KILL) ;;
    *) return 1 ;;
  esac
  /bin/kill "-$signal" "$pid" 2>/dev/null
}

pk_command_has_single_exact_flag() {
  local command="$1" flag="$2" expected_value="$3" padded remaining count=0 expected
  [[ "$flag" =~ ^--[a-z0-9-]+$ ]] || return 1
  [[ "$expected_value" != *$'\n'* && "$expected_value" != *$'\r'* ]] || return 1
  expected="$flag=$expected_value"
  padded=" $command "
  [[ "$padded" == *" $expected "* ]] || return 1
  remaining="$padded"
  while [[ "$remaining" == *" $flag="* ]]; do
    remaining="${remaining#*" $flag="}"
    count=$((count + 1))
  done
  [[ "$count" -eq 1 ]]
}

pk_command_matches_theme_launch() {
  local command="$1" token="$2" port="$3"
  [[ "$token" =~ ^[a-f0-9]{32}$ ]] || return 1
  pk_valid_port "$port" || return 1
  pk_command_has_single_exact_flag "$command" "--prime-knight-launch-token" "$token" || return 1
  pk_command_has_single_exact_flag "$command" "--user-data-dir" "$PK_PROFILE_DIR" || return 1
  pk_command_has_single_exact_flag "$command" "--remote-debugging-address" "$PK_LOOPBACK" || return 1
  pk_command_has_single_exact_flag "$command" "--remote-debugging-port" "$port"
}

pk_read_state_line() {
  local file="$1" value
  [[ -f "$file" && ! -L "$file" ]] || return 1
  IFS= read -r value < "$file" || [[ -n "$value" ]] || return 1
  [[ "$value" != *$'\n'* && "$value" != *$'\r'* ]] || return 1
  printf '%s\n' "$value"
}

pk_watcher_record_present() {
  [[ -f "$PK_STATE_DIR/watcher.pid" || -f "$PK_STATE_DIR/watcher.start" || -f "$PK_STATE_DIR/watcher.token" ]]
}

pk_launch_agent_plist_present() {
  [[ -e "$PK_LAUNCH_AGENT_PLIST" || -L "$PK_LAUNCH_AGENT_PLIST" ]]
}

pk_pending_launch_present() {
  [[ -e "$PK_STATE_DIR/launch.pending" || -L "$PK_STATE_DIR/launch.pending" ]]
}

pk_runtime_record_present() {
  pk_watcher_record_present || pk_launch_agent_plist_present || pk_theme_codex_record_present || pk_pending_launch_present ||
    [[ -f "$PK_STATE_DIR/port" || -f "$PK_STATE_DIR/ready" ]]
}

pk_command_matches_theme_watcher() {
  local command="$1" token="$2" watcher
  [[ "$token" =~ ^[a-f0-9]{32}$ ]] || return 1
  watcher="$PK_INSTALL_DIR/src/runtime/watcher.mjs"
  pk_command_has_single_exact_flag "$command" "--prime-knight-token" "$token" || return 1
  [[ " $command " == *" $watcher "* ]]
}

pk_verified_theme_pid() {
  local pid start token actual_start command owner_uid current_uid
  pid="$(pk_read_state_line "$PK_STATE_DIR/watcher.pid")" || return 1
  start="$(pk_read_state_line "$PK_STATE_DIR/watcher.start")" || return 1
  token="$(pk_read_state_line "$PK_STATE_DIR/watcher.token")" || return 1
  [[ "$pid" =~ ^[1-9][0-9]*$ ]] || return 1
  [[ "$token" =~ ^[a-f0-9]{32}$ ]] || return 1
  if pk_launch_agent_plist_present; then
    pk_validate_owned_launch_agent || return 4
    pid="$(pk_launch_agent_pid)" || return 3
  fi
  pk_process_alive "$pid" || return 3
  current_uid="$(/usr/bin/id -u)"
  owner_uid="$(pk_process_uid "$pid")" || return 4
  [[ "$owner_uid" == "$current_uid" ]] || return 4
  actual_start="$(pk_process_start "$pid")" || return 4
  if ! pk_launch_agent_plist_present; then
    [[ -n "$actual_start" && "$actual_start" == "$start" ]] || return 4
  else
    [[ -n "$actual_start" ]] || return 4
  fi
  command="$(pk_process_command "$pid")" || return 4
  if pk_launch_agent_plist_present; then
    pk_command_matches_theme_watcher "$command" "$token" || return 4
  else
    pk_command_has_single_exact_flag "$command" "--prime-knight-token" "$token" || return 4
  fi
  printf '%s\n' "$pid"
}

pk_commit_pending_launch() {
  local token="$1" port="$2" temporary pending
  [[ "$token" =~ ^[a-f0-9]{32}$ ]] || return 1
  pk_valid_port "$port" || return 1
  pending="$PK_STATE_DIR/launch.pending"
  [[ ! -e "$pending" && ! -L "$pending" ]] || return 1
  temporary="$(/usr/bin/mktemp -d "$PK_STATE_DIR/.launch-pending.XXXXXX")" || return 1
  if ! printf '%s\n' "$token" > "$temporary/token" ||
     ! printf '%s\n' "$port" > "$temporary/port" ||
     ! /bin/mv "$temporary" "$pending"; then
    /bin/rm -rf "$temporary"
    return 1
  fi
}

pk_read_pending_launch_field() {
  local field="$1"
  case "$field" in token|port|pid|start) ;; *) return 1 ;; esac
  [[ -d "$PK_STATE_DIR/launch.pending" && ! -L "$PK_STATE_DIR/launch.pending" ]] || return 1
  pk_read_state_line "$PK_STATE_DIR/launch.pending/$field"
}

pk_candidate_pids() {
  /bin/ps -axo pid= 2>/dev/null | /usr/bin/sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e '/^$/d'
}

pk_pending_candidate_identity() {
  local token port current_uid pid owner_uid command start found_pid="" found_start=""
  token="$(pk_read_pending_launch_field token)" || return 1
  port="$(pk_read_pending_launch_field port)" || return 1
  [[ "$token" =~ ^[a-f0-9]{32}$ ]] || return 1
  pk_valid_port "$port" || return 1
  current_uid="$(/usr/bin/id -u)"
  while IFS= read -r pid; do
    [[ "$pid" =~ ^[1-9][0-9]*$ ]] || continue
    owner_uid="$(pk_process_uid "$pid")" || continue
    [[ "$owner_uid" == "$current_uid" ]] || continue
    command="$(pk_process_command "$pid")" || continue
    pk_command_matches_theme_launch "$command" "$token" "$port" || continue
    start="$(pk_process_start "$pid")" || continue
    [[ -n "$start" ]] || continue
    [[ -z "$found_pid" ]] || return 1
    found_pid="$pid"
    found_start="$start"
  done < <(pk_candidate_pids)
  [[ -n "$found_pid" ]] || return 3
  printf '%s\t%s\n' "$found_pid" "$found_start"
}

pk_write_pending_identity() {
  local pid="$1" start="$2" pending temporary
  [[ "$pid" =~ ^[1-9][0-9]*$ && -n "$start" ]] || return 1
  pending="$PK_STATE_DIR/launch.pending"
  [[ -d "$pending" && ! -L "$pending" ]] || return 1
  temporary="$(/usr/bin/mktemp "$pending/.identity.XXXXXX")" || return 1
  if ! printf '%s\n%s\n' "$pid" "$start" > "$temporary" || ! /bin/mv "$temporary" "$pending/identity"; then
    /bin/rm -f "$temporary"
    return 1
  fi
}

pk_read_pending_identity() {
  local identity pid start extra
  identity="$PK_STATE_DIR/launch.pending/identity"
  [[ -f "$identity" && ! -L "$identity" ]] || return 1
  {
    IFS= read -r pid
    IFS= read -r start
    IFS= read -r extra || true
  } < "$identity"
  [[ "$pid" =~ ^[1-9][0-9]*$ && -n "$start" && -z "$extra" ]] || return 1
  printf '%s\t%s\n' "$pid" "$start"
}

pk_pending_theme_codex_pid() {
  local token port pid start actual_start command owner_uid current_uid identity
  token="$(pk_read_pending_launch_field token)" || return 1
  port="$(pk_read_pending_launch_field port)" || return 1
  identity="$(pk_read_pending_identity)" || identity=""
  if [[ -n "$identity" ]]; then
    pid="${identity%%$'\t'*}"
    start="${identity#*$'\t'}"
  else
    identity="$(pk_pending_candidate_identity)" || return $?
    pid="${identity%%$'\t'*}"
    start="${identity#*$'\t'}"
    pk_write_pending_identity "$pid" "$start" || return 1
  fi
  [[ "$pid" =~ ^[1-9][0-9]*$ && -n "$start" ]] || return 1
  pk_process_alive "$pid" || return 3
  current_uid="$(/usr/bin/id -u)"
  owner_uid="$(pk_process_uid "$pid")" || return 1
  [[ "$owner_uid" == "$current_uid" ]] || return 1
  actual_start="$(pk_process_start "$pid")" || return 1
  [[ "$actual_start" == "$start" ]] || return 1
  command="$(pk_process_command "$pid")" || return 1
  pk_command_matches_theme_launch "$command" "$token" "$port" || return 1
  printf '%s\n' "$pid"
}

pk_stop_pending_theme_codex() {
  local pid status attempt
  pk_pending_launch_present || return 0
  pid="$(pk_pending_theme_codex_pid)" || {
    status=$?
    if [[ "$status" -eq 3 ]] && pk_read_pending_identity >/dev/null 2>&1; then
      return 0
    fi
    return 1
  }
  pk_signal_process TERM "$pid" || return 1
  for ((attempt=0; attempt<50; attempt+=1)); do
    pk_process_alive "$pid" || return 0
    /bin/sleep 0.1
  done
  pid="$(pk_pending_theme_codex_pid)" || {
    status=$?
    if [[ "$status" -eq 3 ]] && pk_read_pending_identity >/dev/null 2>&1; then
      return 0
    fi
    return 1
  }
  pk_signal_process KILL "$pid" || return 1
  for ((attempt=0; attempt<20; attempt+=1)); do
    pk_process_alive "$pid" || return 0
    /bin/sleep 0.1
  done
  return 1
}

pk_theme_codex_record_present() {
  [[ -e "$PK_STATE_DIR/codex.record" || -L "$PK_STATE_DIR/codex.record" ||
     -f "$PK_STATE_DIR/codex.pid" || -f "$PK_STATE_DIR/codex.start" || -f "$PK_STATE_DIR/codex.token" ]]
}

pk_read_theme_codex_field() {
  local field="$1"
  case "$field" in pid|start|token|port) ;; *) return 1 ;; esac
  if [[ -d "$PK_STATE_DIR/codex.record" && ! -L "$PK_STATE_DIR/codex.record" ]]; then
    pk_read_state_line "$PK_STATE_DIR/codex.record/$field"
  elif [[ "$field" == "port" ]]; then
    pk_read_state_line "$PK_STATE_DIR/port"
  else
    pk_read_state_line "$PK_STATE_DIR/codex.$field"
  fi
}

pk_verified_theme_codex_identity() {
  local expected_port="$1" pid start token actual_start command owner_uid current_uid actual_port user_data_dir
  pid="$(pk_read_theme_codex_field pid)" || return 1
  start="$(pk_read_theme_codex_field start)" || return 1
  token="$(pk_read_theme_codex_field token)" || return 1
  [[ "$pid" =~ ^[1-9][0-9]*$ ]] || return 1
  [[ "$token" =~ ^[a-f0-9]{32}$ ]] || return 1
  if ! pk_process_alive "$pid"; then
    return 3
  fi
  current_uid="$(/usr/bin/id -u)"
  owner_uid="$(pk_process_uid "$pid")" || return 1
  [[ "$owner_uid" == "$current_uid" ]] || return 1
  actual_start="$(pk_process_start "$pid")" || return 1
  [[ -n "$actual_start" && "$actual_start" == "$start" ]] || return 1
  command="$(pk_process_command "$pid")" || return 1
  user_data_dir="$PK_PROFILE_DIR"
  if [[ -n "$expected_port" ]]; then
    actual_port="$expected_port"
  elif [[ "$command" =~ (^|[[:space:]])--remote-debugging-port=([0-9]+)($|[[:space:]]) ]]; then
    actual_port="${BASH_REMATCH[2]}"
  else
    return 1
  fi
  pk_command_matches_theme_launch "$command" "$token" "$actual_port" || return 1
  printf '%s\t%s\n' "$pid" "$actual_port"
}

pk_verified_theme_codex_pid() {
  local identity
  identity="$(pk_verified_theme_codex_identity "$1")" || return $?
  printf '%s\n' "${identity%%$'\t'*}"
}

pk_recorded_theme_port() {
  local port identity
  port="$(pk_read_theme_codex_field port)" || port=""
  if pk_valid_port "$port"; then
    printf '%s\n' "$port"
    return 0
  fi
  identity="$(pk_verified_theme_codex_identity "")" || return $?
  printf '%s\n' "${identity#*$'\t'}"
}

pk_stop_verified_theme_codex() {
  local port="$1" pid status attempt
  pid="$(pk_verified_theme_codex_pid "$port")" || {
    status=$?
    [[ "$status" -eq 3 ]] && return 0
    return 1
  }
  pk_signal_process TERM "$pid" || return 1
  for ((attempt=0; attempt<50; attempt+=1)); do
    if ! pk_process_alive "$pid"; then
      return 0
    fi
    /bin/sleep 0.1
  done
  pid="$(pk_verified_theme_codex_pid "$port")" || {
    status=$?
    [[ "$status" -eq 3 ]] && return 0
    return 1
  }
  pk_signal_process KILL "$pid" || return 1
  for ((attempt=0; attempt<20; attempt+=1)); do
    if ! pk_process_alive "$pid"; then
      return 0
    fi
    /bin/sleep 0.1
  done
  return 1
}

pk_stop_verified_watcher() {
  local pid attempt status
  pk_watcher_record_present || return 0
  pid="$(pk_verified_theme_pid)" || {
    status=$?
    [[ "$status" -eq 3 || "$status" -eq 4 ]] && return 0
    return 1
  }
  if ! pk_signal_process TERM "$pid"; then
    pk_verified_theme_pid >/dev/null 2>&1
    status=$?
    [[ "$status" -eq 3 || "$status" -eq 4 ]] && return 0
    return 1
  fi
  for ((attempt=0; attempt<20; attempt+=1)); do
    if ! pk_process_alive "$pid"; then
      return 0
    fi
    /bin/sleep 0.1
  done
  pid="$(pk_verified_theme_pid)" || {
    status=$?
    [[ "$status" -eq 3 || "$status" -eq 4 ]] && return 0
    return 1
  }
  if ! pk_signal_process KILL "$pid"; then
    pk_verified_theme_pid >/dev/null 2>&1
    status=$?
    [[ "$status" -eq 3 || "$status" -eq 4 ]] && return 0
    return 1
  fi
  for ((attempt=0; attempt<20; attempt+=1)); do
    if ! pk_process_alive "$pid"; then
      return 0
    fi
    pk_verified_theme_pid >/dev/null 2>&1
    status=$?
    [[ "$status" -eq 3 || "$status" -eq 4 ]] && return 0
    [[ "$status" -eq 0 ]] || return 1
    /bin/sleep 0.1
  done
  return 1
}

pk_clear_runtime_state() {
  [[ "$PK_STATE_DIR" == "$PK_INSTALL_DIR/.state" ]] || {
    pk_error "refusing to clear state outside the owned installation"
    return 1
  }
  if [[ -L "$PK_STATE_DIR" ]]; then
    /bin/rm -f "$PK_STATE_DIR"
  elif [[ -d "$PK_STATE_DIR" ]]; then
    /bin/rm -rf "$PK_STATE_DIR"
  fi
}

pk_open_application() {
  /usr/bin/open "$@"
}
