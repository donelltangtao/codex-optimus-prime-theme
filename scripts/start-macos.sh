#!/bin/bash
set -euo pipefail

readonly PK_START_SCRIPT_DIR="$(cd "$(/usr/bin/dirname "${BASH_SOURCE[0]}")" && pwd -P)"
source "$PK_START_SCRIPT_DIR/common-macos.sh"

pk_launch_codex_theme() {
  local app_path="$1" port="$2" token="$3" user_data_dir="${4-}"
  local -a args=(
    "--remote-debugging-address=127.0.0.1"
    "--remote-debugging-port=$port"
    "--prime-knight-launch-token=$token"
  )
  if [[ -n "$user_data_dir" ]]; then
    args+=("--user-data-dir=$user_data_dir")
  fi
  pk_valid_port "$port" || {
    pk_error "invalid debugging port"
    return 1
  }
  [[ "$token" =~ ^[a-f0-9]{32}$ ]] || {
    pk_error "invalid Codex launch identity token"
    return 1
  }
  pk_open_application -na "$app_path" --args "${args[@]}"
}

pk_generate_token() {
  /usr/bin/uuidgen | /usr/bin/tr '[:upper:]' '[:lower:]' | /usr/bin/tr -d '-'
}

pk_commit_theme_codex_record() {
  local pid="$1" start="$2" token="$3" port="$4" temporary record
  record="$PK_STATE_DIR/codex.record"
  [[ ! -e "$record" && ! -L "$record" ]] || return 1
  temporary="$(/usr/bin/mktemp -d "$PK_STATE_DIR/.codex-record.XXXXXX")" || return 1
  if ! printf '%s\n' "$pid" > "$temporary/pid" ||
     ! printf '%s\n' "$start" > "$temporary/start" ||
     ! printf '%s\n' "$token" > "$temporary/token" ||
     ! printf '%s\n' "$port" > "$temporary/port" ||
     ! /bin/mv "$temporary" "$record"; then
    /bin/rm -rf "$temporary"
    return 1
  fi
}

pk_record_theme_codex() {
  local port="$1" token="$2" user_data_dir="$3" attempt pid command owner_uid current_uid start
  current_uid="$(/usr/bin/id -u)"
  for ((attempt=0; attempt<200; attempt+=1)); do
    while IFS= read -r pid; do
      [[ "$pid" =~ ^[1-9][0-9]*$ ]] || continue
      owner_uid="$(pk_process_uid "$pid")" || continue
      [[ "$owner_uid" == "$current_uid" ]] || continue
      command="$(pk_process_command "$pid")" || continue
      pk_command_matches_theme_launch "$command" "$token" "$port" || continue
      start="$(pk_process_start "$pid")" || continue
      [[ -n "$start" ]] || continue
      pk_commit_theme_codex_record "$pid" "$start" "$token" "$port" || {
        pk_error "the theme Codex process identity could not be committed safely"
        return 1
      }
      /bin/rm -rf "$PK_STATE_DIR/launch.pending"
      return 0
    done < <(pk_candidate_pids)
    /bin/sleep 0.1
  done
  pk_error "the theme-launched Codex process could not be identified safely"
}

pk_rollback_launch_agent() {
  pk_bootout_launch_agent || return 1
  pk_remove_owned_launch_agent
}

pk_preserve_watcher_failure_log() {
  local source="$PK_STATE_DIR/watcher.log" destination="$PK_INSTALL_DIR/last-start-error.log" temporary
  [[ -f "$source" && ! -L "$source" ]] || return 0
  [[ ! -L "$destination" ]] || return 1
  temporary="$(/usr/bin/mktemp "$PK_INSTALL_DIR/.last-start-error.XXXXXX")" || return 1
  if ! /bin/cp "$source" "$temporary" ||
     ! /bin/chmod 600 "$temporary" ||
     ! /bin/mv "$temporary" "$destination"; then
    /bin/rm -f "$temporary"
    return 1
  fi
}

pk_start_watcher() {
  local port="$1" token watcher_pid watcher_start ready_file attempt command owner_uid current_uid
  token="$(pk_generate_token)" || return 1
  [[ "$token" =~ ^[a-f0-9]{32}$ ]] || {
    pk_error "could not generate a watcher identity token"
    return 1
  }
  if [[ -L "$PK_STATE_DIR" ]]; then
    pk_error "runtime state directory must not be a symlink"
    return 1
  fi
  /bin/mkdir -p "$PK_STATE_DIR"
  ready_file="$PK_STATE_DIR/ready"
  /bin/rm -f "$ready_file"
  if ! pk_write_launch_agent "$port" "$token"; then
    pk_error "the user LaunchAgent could not be written safely"
    return 1
  fi
  if ! pk_bootstrap_launch_agent; then
    if ! pk_rollback_launch_agent >/dev/null 2>&1; then
      pk_error "the user LaunchAgent failed to start and could not be unloaded safely"
      return 3
    fi
    pk_preserve_watcher_failure_log || true
    pk_error "the user LaunchAgent could not be started"
    return 1
  fi
  current_uid="$(/usr/bin/id -u)"
  watcher_pid=""
  for ((attempt=0; attempt<200; attempt+=1)); do
    watcher_pid="$(pk_launch_agent_pid)" || watcher_pid=""
    if [[ "$watcher_pid" =~ ^[1-9][0-9]*$ ]] && pk_process_alive "$watcher_pid"; then
      owner_uid="$(pk_process_uid "$watcher_pid")" || owner_uid=""
      watcher_start="$(pk_process_start "$watcher_pid")" || watcher_start=""
      command="$(pk_process_command "$watcher_pid")" || command=""
      if [[ "$owner_uid" == "$current_uid" && -n "$watcher_start" ]] &&
         pk_command_matches_theme_watcher "$command" "$token"; then
        printf '%s\n' "$watcher_pid" > "$PK_STATE_DIR/watcher.pid"
        printf '%s\n' "$watcher_start" > "$PK_STATE_DIR/watcher.start"
        printf '%s\n' "$token" > "$PK_STATE_DIR/watcher.token"
        break
      fi
    fi
    /bin/sleep 0.1
  done
  if [[ ! "$watcher_pid" =~ ^[1-9][0-9]*$ || ! -f "$PK_STATE_DIR/watcher.token" ]]; then
    if ! pk_rollback_launch_agent >/dev/null 2>&1; then
      pk_error "LaunchAgent watcher identity failed and the service could not be unloaded safely"
      return 3
    fi
    pk_preserve_watcher_failure_log || true
    pk_error "LaunchAgent watcher process identity could not be recorded"
    return 1
  fi
  for ((attempt=0; attempt<200; attempt+=1)); do
    if [[ -f "$ready_file" && ! -L "$ready_file" && "$(pk_read_state_line "$ready_file")" == "ready" ]]; then
      return 0
    fi
    if ! pk_verified_theme_pid >/dev/null; then
      if ! pk_rollback_launch_agent >/dev/null 2>&1; then
        pk_error "theme watcher exited and the LaunchAgent could not be unloaded safely"
        return 3
      fi
      pk_preserve_watcher_failure_log || true
      pk_error "theme watcher exited before injection completed; see $PK_STATE_DIR/watcher.log"
      return 1
    fi
    /bin/sleep 0.1
  done
  if ! pk_rollback_launch_agent >/dev/null 2>&1; then
    pk_error "theme watcher timed out and the LaunchAgent could not be unloaded safely"
    return 3
  fi
  pk_preserve_watcher_failure_log || true
  pk_error "theme watcher timed out; see $PK_STATE_DIR/watcher.log"
}

start_main() {
  pk_reject_args "$#" || return $?
  pk_initialize_paths "${BASH_SOURCE[0]}" || return $?
  pk_require_supported_environment || return $?
  pk_verify_installation_manifest || return 1
  pk_require_cdp_capability || return $?
  local existing_pid existing_port codex_app port launch_token codex_app_profile_dir
  if existing_pid="$(pk_verified_theme_pid)"; then
    existing_port="$(pk_recorded_theme_port)" || existing_port=""
    if pk_valid_port "$existing_port" && pk_verified_theme_codex_identity "$existing_port" >/dev/null; then
      printf 'Prime Knight theme is already running (watcher %s)\n' "$existing_pid"
      return 0
    fi
    pk_error "watcher state exists without the exact theme Codex identity; run Restore Native Codex"
    return 1
  fi
  if pk_runtime_record_present; then
    pk_error "recoverable runtime state exists; run Restore Native Codex before starting again"
    return 1
  fi
  pk_clear_runtime_state || return 1
  /bin/mkdir -p "$PK_STATE_DIR"
  codex_app="$(pk_discover_codex_app)" || return 1
  pk_verify_codex_signature "$codex_app" || return 1
  port="$(pk_choose_port)" || return 1
  launch_token="$(pk_generate_token)" || return 1
  codex_app_profile_dir="$PK_PROFILE_DIR"
  pk_refuse_symlink_components "$PK_INSTALL_DIR" "$codex_app_profile_dir" || return 1
  /bin/mkdir -p "$codex_app_profile_dir"
  pk_commit_pending_launch "$launch_token" "$port" || {
    pk_error "the pending launch identity could not be committed safely"
    return 1
  }
  if ! pk_launch_codex_theme "$codex_app" "$port" "$launch_token" "$codex_app_profile_dir"; then
    pk_clear_runtime_state || true
    return 1
  fi
  if ! pk_record_theme_codex "$port" "$launch_token" "$codex_app_profile_dir"; then
    pk_error "the theme-launched Codex process could not be identified safely" || true
    if pk_stop_pending_theme_codex; then
      pk_clear_runtime_state || true
    else
      pk_error "post-launch rollback was incomplete; pending identity state was preserved" || true
    fi
    return 1
  fi
  local watcher_status=0
  if pk_start_watcher "$port"; then
    :
  else
    watcher_status=$?
    local rollback_failed=0
    if [[ "$watcher_status" -eq 3 ]]; then
      rollback_failed=1
    else
      pk_stop_verified_watcher || rollback_failed=1
    fi
    pk_stop_verified_theme_codex "$port" || rollback_failed=1
    if [[ "$rollback_failed" -eq 0 ]]; then
      pk_clear_runtime_state || true
    else
      pk_error "startup rollback was incomplete; verified identity state was preserved"
    fi
    return 1
  fi
  printf 'Prime Knight theme started on %s:%s\n' "$PK_LOOPBACK" "$port"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  if start_main "$@"; then
    exit 0
  else
    status=$?
    [[ "$status" -eq 2 ]] && exit 2
    exit 1
  fi
fi
