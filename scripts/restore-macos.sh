#!/bin/bash
set -euo pipefail

readonly PK_RESTORE_SCRIPT_DIR="$(cd "$(/usr/bin/dirname "${BASH_SOURCE[0]}")" && pwd -P)"
source "$PK_RESTORE_SCRIPT_DIR/common-macos.sh"

pk_send_remove_payload() {
  local port="$1"
  pk_valid_port "$port" || return 1
  pk_run_cdp_node --input-type=module - "$PK_INSTALL_DIR" "$port" <<'NODE'
import path from "node:path";
import { pathToFileURL } from "node:url";

const [root, rawPort] = process.argv.slice(2);
const port = Number(rawPort);
const injector = await import(pathToFileURL(path.join(root, "src/runtime/injector.mjs")));
const target = await injector.discoverTarget({ port });
const session = await new injector.CdpSession(target.target, port).open();
try {
  const removed = await injector.removePayload(session);
  if (!removed) throw new Error("theme-owned DOM was not removed");
} finally {
  session.close();
}
NODE
}

pk_open_codex_native() {
  pk_open_application -a "$1"
}

restore_main() {
  pk_reject_args "$#" || return $?
  pk_initialize_paths "${BASH_SOURCE[0]}" || return $?
  pk_require_supported_environment || return $?
  local codex_app="" port="" runtime_failure=0 had_runtime_state=0 preserve_state=0 identity_status=0
  codex_app="$(pk_discover_codex_app)" || return 1
  pk_verify_codex_signature "$codex_app" || return 1
  if [[ -e "$PK_INSTALL_DIR" || -L "$PK_INSTALL_DIR" ]]; then
    pk_require_installation || return 1
    if pk_runtime_record_present; then
      had_runtime_state=1
    fi
    port="$(pk_recorded_theme_port)" || port=""
    if pk_valid_port "$port"; then
      if pk_verified_theme_codex_identity "$port" >/dev/null; then
        identity_status=0
      else
        identity_status=$?
      fi
      if [[ "$identity_status" -eq 3 ]]; then
        :
      elif [[ "$identity_status" -ne 0 ]]; then
        printf 'Prime Knight: theme Codex identity was not confirmed; renderer cleanup was skipped\n' >&2
        runtime_failure=1
        preserve_state=1
      elif ! pk_require_cdp_capability; then
        printf 'Prime Knight: renderer cleanup is unavailable with this Node runtime\n' >&2
        runtime_failure=1
      elif ! pk_send_remove_payload "$port"; then
        printf 'Prime Knight: renderer cleanup could not be confirmed\n' >&2
        runtime_failure=1
      fi
    elif [[ "$had_runtime_state" -eq 1 ]] && ! pk_pending_launch_present; then
      printf 'Prime Knight: recorded debugging port is missing or invalid\n' >&2
      runtime_failure=1
    fi

    if pk_pending_launch_present; then
      if ! pk_stop_pending_theme_codex; then
        printf 'Prime Knight: pending theme Codex exit could not be confirmed; identity state was preserved\n' >&2
        runtime_failure=1
        preserve_state=1
      fi
    fi

    if pk_launch_agent_plist_present; then
      if ! pk_bootout_launch_agent; then
        printf 'Prime Knight: LaunchAgent exit could not be confirmed; identity state was preserved\n' >&2
        runtime_failure=1
        preserve_state=1
      elif ! pk_remove_owned_launch_agent; then
        printf 'Prime Knight: owned LaunchAgent plist could not be removed safely; identity state was preserved\n' >&2
        runtime_failure=1
        preserve_state=1
      fi
    elif pk_watcher_record_present; then
      if ! pk_stop_verified_watcher; then
        printf 'Prime Knight: legacy watcher exit could not be confirmed; identity state was preserved\n' >&2
        runtime_failure=1
        preserve_state=1
      fi
    fi

    if pk_theme_codex_record_present; then
      if ! pk_valid_port "$port" || ! pk_stop_verified_theme_codex "$port"; then
        printf 'Prime Knight: theme Codex process identity or exit could not be confirmed\n' >&2
        runtime_failure=1
        preserve_state=1
      fi
    elif [[ "$had_runtime_state" -eq 1 ]] && ! pk_pending_launch_present; then
      printf 'Prime Knight: theme Codex process record is missing\n' >&2
      runtime_failure=1
      preserve_state=1
    fi
    if [[ "$preserve_state" -eq 0 ]]; then
      pk_clear_runtime_state || return 1
    fi
  fi
  pk_open_codex_native "$codex_app" || return 1
  if [[ "$runtime_failure" -ne 0 ]]; then
    return 1
  fi
  printf 'Prime Knight runtime state removed; native Codex opened\n'
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  if restore_main "$@"; then
    exit 0
  else
    status=$?
    [[ "$status" -eq 2 ]] && exit 2
    exit 1
  fi
fi
