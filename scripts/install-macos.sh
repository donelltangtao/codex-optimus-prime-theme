#!/bin/bash
set -euo pipefail

readonly PK_INSTALL_SCRIPT_DIR="$(cd "$(/usr/bin/dirname "${BASH_SOURCE[0]}")" && pwd -P)"
source "$PK_INSTALL_SCRIPT_DIR/common-macos.sh"

pk_validate_source_tree() {
  pk_validate_owned_files "$PK_SOURCE_ROOT" || return $?
  pk_verify_package_metadata "$PK_SOURCE_ROOT" || return $?
  "$PK_NODE" "$PK_SOURCE_ROOT/scripts/verify-backgrounds.mjs" \
    "$PK_SOURCE_ROOT/config/backgrounds.json" \
    "$PK_SOURCE_ROOT/assets/backgrounds" >/dev/null || {
      pk_error "source background checksum validation failed"
      return 1
    }
}

pk_copy_tree_to_staging() {
  local staging="$1" relative source_file destination_file
  while IFS= read -r relative; do
    source_file="$PK_SOURCE_ROOT/$relative"
    destination_file="$staging/$relative"
    /bin/mkdir -p "$(/usr/bin/dirname "$destination_file")"
    /bin/cp -p "$source_file" "$destination_file"
  done < <(pk_owned_relative_paths)
  printf '%s\n' "$PK_OWNER_VALUE" > "$staging/.prime-knight-owner"
  pk_write_install_manifest "$staging" "$staging/.install-manifest.sha256"
}

pk_update_owned_installation() {
  local staging="$1" relative source_file destination_file destination_parent temporary
  while IFS= read -r relative; do
    destination_file="$PK_INSTALL_DIR/$relative"
    pk_refuse_symlink_components "$PK_INSTALL_DIR" "$destination_file" || return $?
    if [[ -e "$destination_file" && ! -f "$destination_file" ]]; then
      pk_error "refusing to overwrite a non-file owned path: $relative"
      return 1
    fi
  done < <(pk_owned_relative_paths)
  while IFS= read -r relative; do
    source_file="$staging/$relative"
    destination_file="$PK_INSTALL_DIR/$relative"
    if [[ -f "$destination_file" ]] && /usr/bin/cmp -s "$source_file" "$destination_file"; then
      continue
    fi
    destination_parent="$(/usr/bin/dirname "$destination_file")"
    /bin/mkdir -p "$destination_parent"
    temporary="$(/usr/bin/mktemp "$destination_parent/.prime-knight-update.XXXXXX")" || return 1
    if ! /bin/cp -p "$source_file" "$temporary"; then
      /bin/rm -f "$temporary"
      return 1
    fi
    /bin/mv -f "$temporary" "$destination_file"
  done < <(pk_owned_relative_paths)
  if ! /usr/bin/cmp -s "$staging/.install-manifest.sha256" "$PK_INSTALL_DIR/.install-manifest.sha256"; then
    temporary="$(/usr/bin/mktemp "$PK_INSTALL_DIR/.prime-knight-manifest.XXXXXX")" || return 1
    if ! /bin/cp -p "$staging/.install-manifest.sha256" "$temporary"; then
      /bin/rm -f "$temporary"
      return 1
    fi
    /bin/mv -f "$temporary" "$PK_INSTALL_DIR/.install-manifest.sha256"
  fi
}

install_main() {
  pk_reject_args "$#" || return $?
  pk_initialize_paths "${BASH_SOURCE[0]}" || return $?
  pk_assert_install_boundary || return $?
  pk_require_supported_environment || return $?
  local codex_app
  codex_app="$(pk_discover_codex_app)" || return 1
  pk_verify_codex_signature "$codex_app" || return 1
  pk_validate_source_tree || return $?

  local install_parent staging
  install_parent="$(/usr/bin/dirname "$PK_INSTALL_DIR")"
  pk_refuse_symlink_components "$PK_HOME" "$install_parent" || return $?
  /bin/mkdir -p "$install_parent"
  staging="$(/usr/bin/mktemp -d "$install_parent/.prime-knight-install.XXXXXX")" || return 1
  if ! pk_copy_tree_to_staging "$staging"; then
    /bin/rm -rf "$staging"
    return 1
  fi
  if [[ ! -e "$PK_INSTALL_DIR" ]]; then
    /bin/mv "$staging" "$PK_INSTALL_DIR"
  else
    if ! pk_update_owned_installation "$staging"; then
      /bin/rm -rf "$staging"
      return 1
    fi
    /bin/rm -rf "$staging"
  fi
  printf 'Prime Knight theme installed at %s\n' "$PK_INSTALL_DIR"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  if install_main "$@"; then
    exit 0
  else
    status=$?
    [[ "$status" -eq 2 ]] && exit 2
    exit 1
  fi
fi
