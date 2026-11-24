#!/usr/bin/env bash
set -euo pipefail
umask 077

install_latest_release() (
  fail() { printf '%s\n' "$1" >&2; exit 1; }

  [[ $# -eq 0 ]] || fail '用法为 bash install.sh --latest。'
  [[ $(uname -s) == Linux && $(uname -m) == x86_64 ]] || fail '这个发行包适用于 Linux x86_64。'
  for tool in curl tar sha256sum; do
    command -v "$tool" >/dev/null || fail "请安装 $tool 后重试。"
  done

  releases=https://github.com/Mobiwuhu/boathook/releases
  release_info=$(curl -fsSL --retry 2 --max-time 30 "$releases/latest/download/boathook-linux-x64.sha256") ||
    fail '无法下载最新发行版的校验文件，请检查网络后重试。'
  read -r checksum archive <<< "$release_info"
  [[ $checksum =~ ^[0-9a-f]{64}$ &&
    $archive =~ ^boathook-linux-x64-([0-9]+\.[0-9]+\.[0-9]+)\.tar\.gz$ ]] ||
    fail '最新发行版的 Linux x86-64 校验文件格式无效。'
  tag="v${BASH_REMATCH[1]}"

  download_dir=$(mktemp -d)
  trap 'rm -rf -- "$download_dir"' EXIT
  curl -fsSL --retry 2 --max-time 180 --output "$download_dir/$archive" "$releases/download/$tag/$archive" ||
    fail '无法下载发行包，请检查网络后重试。'
  if ! (cd -- "$download_dir" &&
    printf '%s  %s\n' "$checksum" "$archive" | sha256sum --check --status); then
    fail '发行包的 SHA-256 校验失败，请重新下载。'
  fi
  tar -xzf "$download_dir/$archive" -C "$download_dir"
  bash "$download_dir/boathook-linux-x64/install.sh"
)

if [[ ${1-} == --latest ]]; then
  shift
  install_latest_release "$@"
  exit 0
fi

package_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
source "$package_dir/scripts/install-entry.sh"

case "${1-}" in
  ""|--dry-run) [[ $# -le 1 ]] || fail '用法为 bash install.sh [--dry-run]。' ;;
  *) fail '用法为 bash install.sh [--dry-run]。' ;;
esac
[[ $(uname -s) == Linux && $(uname -m) == x86_64 ]] || fail '这个发行包适用于 Linux x86_64。'
cd -- "$package_dir"
[[ -f manifest.json && -x bin/bun && -x bin/boathook ]] || fail '请先解压完整的 boathook 发行包。'
for tool in sha256sum curl unzip ldd flock; do
  command -v "$tool" >/dev/null || fail "请安装 $tool 后重试。"
done
sha256sum --check --quiet checksums.txt || fail '发行包校验失败，请重新获取发行包。'
sha256sum --check --quiet core-checksums.txt || fail '核心文件校验失败，请重新获取发行包。'

declare -a manifest
mapfile -t manifest < <(./bin/bun -e '
  const m = await Bun.file("manifest.json").json();
  console.log(m.version);
  console.log(m.chrome.version);
  console.log(m.chrome.url);
  console.log(m.chrome.sha256);
  console.log(m.bun);
  console.log(m.plugins.map(({ id }) => id).join(", "));
')
[[ ${#manifest[@]} -eq 6 && ${manifest[0]} =~ ^[0-9]+\.[0-9]+\.[0-9]+$ && ${manifest[3]} =~ ^[0-9a-f]{64}$ ]] || fail '发行清单无效，请重新获取发行包。'

version=${manifest[0]}
resolve_install_paths
release="$store/releases/$version"
printf 'boathook %s → %s\n' "$version" "$release"
printf '命令入口 %s\n' "$entry"
printf 'Bun %s 随包提供\n' "${manifest[4]}"
printf 'Chrome for Testing %s\n%s\nSHA-256 %s\n' "${manifest[1]}" "${manifest[2]}" "${manifest[3]}"
printf '可按 ID 启用的插件 %s\n' "${manifest[5]:-无}"
printf '系统依赖由 ldd 检查。缺少库时会列出名称。\n'
[[ ${1-} != --dry-run ]] || exit 0

mkdir -p -- "$store/releases"
exec {install_lock}>"$store/releases/.install.lock"
flock -x "$install_lock"
check_command_entry
if [[ -d $release ]]; then
  cmp -s core-checksums.txt "$release/core-checksums.txt" || fail "已有不同内容的同版本核心 $release，请使用独立安装目录。"
  (cd -- "$release" && sha256sum --check --quiet core-checksums.txt) || fail '已有发行版本校验失败，请检查对应的安装目录。'
else
  stage=$(mktemp -d "$store/releases/.install-$version.XXXXXX")
  trap 'rm -rf -- "$stage"' EXIT
  archive=${BOATHOOK_CHROME_ARCHIVE:-"$stage/chrome.zip"}
  if [[ -z ${BOATHOOK_CHROME_ARCHIVE-} ]]; then
    curl -fsSL --retry 2 --max-time 180 --output "$archive" "${manifest[2]}" || fail 'Chrome 下载失败，请检查网络或提供已下载的 Chrome ZIP。'
  fi
  [[ -f $archive ]] || fail '找不到 Chrome ZIP，请检查 BOATHOOK_CHROME_ARCHIVE。'
  read -r actual _ < <(sha256sum -- "$archive")
  [[ $actual == "${manifest[3]}" ]] || fail 'Chrome ZIP 校验失败，请重新下载。'
  unzip -q "$archive" -d "$stage"
  mv -- "$stage/chrome-linux64" "$stage/chrome"
  if [[ $archive == "$stage/chrome.zip" ]]; then rm -- "$archive"; fi
  ldd "$stage/chrome/chrome" > "$stage/libs.txt" || fail '无法读取 Chrome 的系统依赖，请检查 Linux 运行环境。'
  if grep -F 'not found' "$stage/libs.txt" >&2; then fail 'Chrome 缺少上述系统库，请安装后重新运行。'; fi
  rm -- "$stage/libs.txt"
  cp -R -- bin licenses scripts install.sh core-checksums.txt manifest.json "$stage/"
  env -u BOATHOOK_CHROME_EXECUTABLE -u BOATHOOK_BUN_EXECUTABLE "$stage/bin/boathook" --json doctor
  mv -T -- "$stage" "$release"
  trap - EXIT
fi
BOATHOOK_STATE_DIR="$store" ./bin/bun -e '
  const { plugins } = await Bun.file("manifest.json").json();
  const env = { ...process.env, BOATHOOK_SESSION: "" };
  const binary = process.argv[1];
  for (const { id, version, file } of plugins) {
    if (!/^plugins\/[a-zA-Z0-9_.%+-]+\.tgz$/.test(file)) {
      throw new Error("发行包包含无效的插件文件名。");
    }
    const existing = Bun.spawnSync([binary, "--json", "plugin", "ls"], { env });
    if (existing.exitCode === 0 && JSON.parse(existing.stdout.toString()).data.some(
      (plugin) => plugin.id === id && plugin.version === version
    )) continue;
    const child = Bun.spawn([binary, "plugin", "install", process.cwd() + "/" + file], {
      env, stdout: "inherit", stderr: "inherit",
    });
    if (await child.exited !== 0) throw new Error("插件安装失败，请检查发行包后重新执行安装脚本。");
  }
' "$release/bin/boathook"
link_command_entry "$release/bin/boathook"
printf '安装完成。运行 %s --version 检查命令入口。\n' "$entry"
