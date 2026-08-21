#!/bin/bash
set -euo pipefail

readonly PK_VERIFY_SCRIPT_DIR="$(cd "$(/usr/bin/dirname "${BASH_SOURCE[0]}")" && pwd -P)"
source "$PK_VERIFY_SCRIPT_DIR/common-macos.sh"

pk_verify_renderer() {
  local port="$1"
  pk_valid_port "$port" || {
    pk_error "recorded debugging port is invalid"
    return 1
  }
  pk_run_cdp_node --input-type=module - "$PK_INSTALL_DIR" "$port" <<'NODE'
import path from "node:path";
import { pathToFileURL } from "node:url";

const [root, rawPort] = process.argv.slice(2);
const port = Number(rawPort);
const injector = await import(pathToFileURL(path.join(root, "src/runtime/injector.mjs")));
const target = await injector.discoverTarget({ port });
const session = await new injector.CdpSession(target.target, port).open();
try {
  const result = await injector.verifyPayload(session);
  if (!result.pass || result.ownedNodeCount !== 2) throw new Error("owned DOM verification failed");
  console.log(JSON.stringify(result));
} finally {
  session.close();
}
NODE
}

verify_main() {
  pk_reject_args "$#" || return $?
  pk_initialize_paths "${BASH_SOURCE[0]}" || return $?
  pk_require_supported_environment || return $?
  pk_require_cdp_capability || return $?
  local codex_app port watcher_pid
  codex_app="$(pk_discover_codex_app)" || return 1
  pk_verify_codex_signature "$codex_app" || return 1
  pk_verify_installation_manifest || return 1
  pk_verify_package_metadata "$PK_INSTALL_DIR" || return 1
  "$PK_NODE" "$PK_INSTALL_DIR/scripts/verify-backgrounds.mjs" \
    "$PK_INSTALL_DIR/config/backgrounds.json" \
    "$PK_INSTALL_DIR/assets/backgrounds" || {
      pk_error "24-background checksum verification failed"
      return 1
    }
  watcher_pid="$(pk_verified_theme_pid)" || {
    pk_error "recorded theme watcher is not running or its identity is stale"
    return 1
  }
  port="$(pk_recorded_theme_port)" || {
    pk_error "recorded debugging port is missing"
    return 1
  }
  pk_verified_theme_codex_identity "$port" >/dev/null || {
    pk_error "recorded theme Codex process is not running with the exact launch identity"
    return 1
  }
  pk_verify_renderer "$port" || {
    pk_error "injector state or owned DOM verification failed"
    return 1
  }
  printf 'Prime Knight verification passed (watcher %s, %s:%s)\n' "$watcher_pid" "$PK_LOOPBACK" "$port"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  if verify_main "$@"; then
    exit 0
  else
    status=$?
    [[ "$status" -eq 2 ]] && exit 2
    exit 1
  fi
fi
