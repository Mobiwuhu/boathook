#!/usr/bin/env bash

fail() { printf '%s\n' "$1" >&2; exit 1; }

resolve_install_paths() {
  store=${BOATHOOK_STATE_DIR:-"$HOME/.boathook"}
  entry_dir=${BOATHOOK_BIN_DIR:-"$HOME/.local/bin"}
  [[ $store = /* && $entry_dir = /* ]] || fail '请为 BOATHOOK_STATE_DIR 和 BOATHOOK_BIN_DIR 使用绝对路径。'
  entry="$entry_dir/boathook"
}

check_command_entry() {
  if [[ -n ${BOATHOOK_EXPECTED_ENTRY-} && $(readlink -- "$entry") != "$BOATHOOK_EXPECTED_ENTRY" ]]; then
    fail 'boathook 命令入口在升级期间已更改，请重新检查版本后重试。'
  fi
  if [[ -e $entry || -L $entry ]]; then
    [[ -L $entry && ! -d $entry && $(readlink "$entry") == "$store/releases/"*/bin/boathook ]] ||
      fail "已有其他命令占用 $entry，请指定其他 BOATHOOK_BIN_DIR。"
  fi
}

link_command_entry() {
  check_command_entry
  mkdir -p -- "$entry_dir"
  if [[ ! -L $entry ]]; then
    ln -s -- "$1" "$entry"
    return
  fi
  local stage
  stage=$(mktemp -d "$entry_dir/.boathook-link.XXXXXX")
  if ! ln -s -- "$1" "$stage/boathook" || ! mv -f -- "$stage/boathook" "$entry"; then
    rm -f -- "$stage/boathook"
    rmdir -- "$stage"
    fail '切换 boathook 命令入口失败，请检查安装目录权限。'
  fi
  rmdir -- "$stage"
}
