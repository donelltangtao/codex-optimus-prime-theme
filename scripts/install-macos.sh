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

pk_launcher_app_is_owned() {
  local app_path="$1" bundle_id executable owner
  [[ -d "$app_path" && ! -L "$app_path" && -O "$app_path" ]] || return 1
  bundle_id="$(pk_bundle_identifier "$app_path")" || return 1
  [[ "$bundle_id" == "io.github.donelltangtao.codex-prime-knight-launcher" ]] || return 1
  executable="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$app_path/Contents/Info.plist" 2>/dev/null)" || return 1
  [[ "$executable" == "Codex擎天柱主题" && -x "$app_path/Contents/MacOS/$executable" ]] || return 1
  owner="$(/usr/libexec/PlistBuddy -c 'Print :PrimeKnightOwner' "$app_path/Contents/Info.plist" 2>/dev/null)" || return 1
  [[ "$owner" == "$PK_OWNER_VALUE" ]]
}

pk_install_launcher_app() {
  local source_app applications_dir destination_app desktop_dir shortcut staging staged_app
  source_app="$PK_SOURCE_ROOT/macos/Codex 擎天柱主题.app"
  applications_dir="$PK_HOME/Applications"
  destination_app="$applications_dir/Codex 擎天柱主题.app"
  desktop_dir="$PK_HOME/Desktop"
  shortcut="$desktop_dir/Codex 擎天柱主题.app"

  pk_launcher_app_is_owned "$source_app" || {
    pk_error "launcher application is missing or its identity is invalid"
    return 1
  }
  if [[ -e "$destination_app" || -L "$destination_app" ]]; then
    pk_launcher_app_is_owned "$destination_app" || {
      pk_error "launcher application destination is not owned by Prime Knight"
      return 1
    }
  fi
  for directory in "$applications_dir" "$desktop_dir"; do
    if [[ -L "$directory" || ( -e "$directory" && ! -d "$directory" ) ]]; then
      pk_error "launcher destination directory is unsafe: $directory"
      return 1
    fi
    /bin/mkdir -p "$directory"
    [[ -d "$directory" && ! -L "$directory" && -O "$directory" ]] || {
      pk_error "launcher destination directory is not owned by the current user: $directory"
      return 1
    }
  done

  staging="$(/usr/bin/mktemp -d "$applications_dir/.prime-knight-launcher.XXXXXX")" || return 1
  staged_app="$staging/Codex 擎天柱主题.app"
  if ! /usr/bin/ditto "$source_app" "$staged_app" || ! pk_launcher_app_is_owned "$staged_app"; then
    /bin/rm -rf "$staging"
    pk_error "launcher application could not be staged safely"
    return 1
  fi
  if ! /usr/bin/codesign --verify --deep --strict "$staged_app" >/dev/null 2>&1; then
    /bin/rm -rf "$staging"
    pk_error "launcher application signature verification failed"
    return 1
  fi
  if [[ -d "$destination_app" ]]; then
    /bin/mv "$destination_app" "$staging/previous.app" || {
      /bin/rm -rf "$staging"
      return 1
    }
  fi
  if ! /bin/mv "$staged_app" "$destination_app"; then
    [[ -d "$staging/previous.app" ]] && /bin/mv "$staging/previous.app" "$destination_app"
    /bin/rm -rf "$staging"
    return 1
  fi
  /bin/rm -rf "$staging"

  if [[ -e "$shortcut" || -L "$shortcut" ]]; then
    if [[ ! -L "$shortcut" || "$(/usr/bin/readlink "$shortcut" 2>/dev/null)" != "$destination_app" ]]; then
      printf 'Prime Knight: desktop shortcut already exists and was preserved: %s\n' "$shortcut" >&2
    fi
  else
    /bin/ln -s "$destination_app" "$shortcut" || {
      pk_error "desktop launcher shortcut could not be created"
      return 1
    }
  fi
  printf 'Prime Knight launcher installed at %s\n' "$destination_app"
  printf 'Prime Knight desktop shortcut available at %s\n' "$shortcut"
}

pk_start_installed_theme() {
  local start_command="$PK_INSTALL_DIR/Start Prime Knight Theme.command"
  pk_refuse_symlink_components "$PK_INSTALL_DIR" "$start_command" || return $?
  [[ -f "$start_command" && ! -L "$start_command" && -O "$start_command" ]] || {
    pk_error "installed theme start entry is missing or unsafe"
    return 1
  }
  /bin/bash "$start_command"
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
  pk_install_launcher_app || return $?
  printf 'Prime Knight theme installed at %s\n' "$PK_INSTALL_DIR"
}

install_and_launch_main() {
  install_main "$@" || return $?
  pk_start_installed_theme || {
    pk_error "theme was installed, but the themed window could not be started"
    return 1
  }
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  if install_and_launch_main "$@"; then
    exit 0
  else
    status=$?
    [[ "$status" -eq 2 ]] && exit 2
    exit 1
  fi
fi
