#!/usr/bin/env bash
set -euo pipefail
umask 077

repo=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
source "$repo/scripts/install-entry.sh"
resolve_install_paths
check_command_entry

cd -- "$repo"
bun_version=$(cat .bun-version)
command -v bun >/dev/null || fail "请安装 Bun $bun_version 后重试。"
[[ $(bun --version) == "$bun_version" ]] || fail "请切换到 Bun $bun_version 后重试。"
bun install --frozen-lockfile
if [[ -n ${BOATHOOK_CHROME_EXECUTABLE:-} ]]; then
  [[ -x $BOATHOOK_CHROME_EXECUTABLE ]] || fail 'BOATHOOK_CHROME_EXECUTABLE 必须指向可执行的 Chrome。'
else
  chrome_args=(install chrome)
  if [[ $(uname -s) == Linux ]]; then chrome_args+=(--with-deps); fi
  bun ./node_modules/playwright/cli.js "${chrome_args[@]}"
fi
bun run build
if [[ $(uname -s) == Darwin ]]; then codesign -s - -f dist/boathook; fi

source_release="$store/releases/source/bin/boathook"
mkdir -p -- "$(dirname -- "$source_release")"
ln -sfn -- "$repo/dist/boathook" "$source_release"
link_command_entry "$source_release"
printf '安装完成。运行 %s --version 检查命令入口。\n' "$entry"
