#!/usr/bin/env bash
set -euo pipefail
umask 077

machine=$(uname -m)
installer_command=(bash)
case "$(uname -s):$machine" in
  Linux:x86_64)
    platform=linux-x64
    checksum_command=(sha256sum)
    lock_command=(flock -x)
    ;;
  Darwin:arm64|Darwin:x86_64)
    platform=darwin-x64
    # A shell running under Rosetta reports x86_64 on Apple Silicon.
    if [[ $machine == arm64 || $(/usr/sbin/sysctl -n hw.optional.arm64 2>/dev/null) == 1 ]]; then
      platform=darwin-arm64
      installer_command=(/usr/bin/arch -arm64 /bin/bash)
    fi
    checksum_command=(shasum -a 256)
    lock_command=(lockf)
    ;;
  *)
    printf '%s\n' 'boathook 发行包适用于 Linux x86-64 和 macOS（Apple Silicon 或 Intel）。' >&2
    exit 1
    ;;
esac

install_latest_release() (
  fail() { printf '%s\n' "$1" >&2; exit 1; }

  [[ $# -eq 0 ]] || fail '用法为 bash install.sh --latest。'
  for tool in curl tar "${checksum_command[0]}"; do
    command -v "$tool" >/dev/null || fail "请安装 $tool 后重试。"
  done

  releases=https://github.com/Mobiwuhu/boathook/releases
  release_info=$(curl -fsSL --retry 2 --max-time 30 "$releases/latest/download/boathook-$platform.sha256") ||
    fail '无法下载最新发行版的校验文件，请检查网络后重试。'
  read -r checksum archive <<< "$release_info"
  archive_pattern="^boathook-$platform-([0-9]+\.[0-9]+\.[0-9]+)\.tar\.gz$"
  [[ $checksum =~ ^[0-9a-f]{64}$ && $archive =~ $archive_pattern ]] ||
    fail '最新发行版的校验文件格式无效。'
  tag="v${BASH_REMATCH[1]}"

  download_dir=$(mktemp -d)
  trap 'rm -rf -- "$download_dir"' EXIT
  curl -fsSL --retry 2 --max-time 180 --output "$download_dir/$archive" "$releases/download/$tag/$archive" ||
    fail '无法下载发行包，请检查网络后重试。'
  if ! (cd -- "$download_dir" &&
    printf '%s  %s\n' "$checksum" "$archive" | "${checksum_command[@]}" --check --status); then
    fail '发行包的 SHA-256 校验失败，请重新下载。'
  fi
  tar -xzf "$download_dir/$archive" -C "$download_dir"
  "${installer_command[@]}" "$download_dir/boathook-$platform/install.sh"
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
cd -- "$package_dir"
[[ -f manifest.json && -x bin/boathook ]] || fail '请先解压完整的 boathook 发行包。'
run_bun() { BUN_BE_BUN=1 ./bin/boathook "$@"; }
tools=(curl unzip "${checksum_command[0]}" "${lock_command[0]}")
if [[ $platform == linux-x64 ]]; then tools+=(ldd); fi
for tool in "${tools[@]}"; do
  command -v "$tool" >/dev/null || fail "请安装 $tool 后重试。"
done
"${checksum_command[@]}" --check --quiet checksums.txt || fail '发行包校验失败，请重新获取发行包。'
"${checksum_command[@]}" --check --quiet core-checksums.txt || fail '核心文件校验失败，请重新获取发行包。'

manifest_text=$(run_bun -e '
  const m = await Bun.file("manifest.json").json();
  console.log(m.version);
  console.log(m.platform);
  console.log(m.chrome.version);
  console.log(m.chrome.url);
  console.log(m.chrome.sha256);
  console.log(m.chrome.directory);
  console.log(m.bun);
  console.log(m.plugins.map(({ id }) => id).join(", ") || "无");
') || fail '无法读取发行清单，请检查平台和架构。'
manifest=()
while IFS= read -r line; do manifest+=("$line"); done <<< "$manifest_text"
[[ ${#manifest[@]} -eq 8 && ${manifest[0]} =~ ^[0-9]+\.[0-9]+\.[0-9]+$ &&
  ${manifest[4]} =~ ^[0-9a-f]{64}$ && ${manifest[5]} =~ ^chrome-(linux64|mac-arm64|mac-x64)$ ]] ||
  fail '发行清单无效，请重新获取发行包。'
[[ ${manifest[1]} == "$platform" ]] || fail '发行包与此机器的平台或架构不匹配。'

version=${manifest[0]}
resolve_install_paths
release="$store/releases/$version"
printf 'boathook %s → %s\n' "$version" "$release"
printf '命令入口 %s\n' "$entry"
printf '内置 Bun %s\n' "${manifest[6]}"
printf 'Chrome for Testing %s\n%s\nSHA-256 %s\n' "${manifest[2]}" "${manifest[3]}" "${manifest[4]}"
printf '可按 ID 启用的插件 %s\n' "${manifest[7]}"
[[ ${1-} != --dry-run ]] || exit 0

mkdir -p -- "$store/releases"
exec 9>"$store/releases/.install.lock"
"${lock_command[@]}" 9
check_command_entry
if [[ -d $release ]]; then
  cmp -s core-checksums.txt "$release/core-checksums.txt" || fail "已有不同内容的同版本核心 $release，请使用独立安装目录。"
  (cd -- "$release" && "${checksum_command[@]}" --check --quiet core-checksums.txt) || fail '已有发行版本校验失败，请检查对应的安装目录。'
else
  stage=$(mktemp -d "$store/releases/.install-$version.XXXXXX")
  trap 'rm -rf -- "$stage"' EXIT
  archive=${BOATHOOK_CHROME_ARCHIVE:-"$stage/chrome.zip"}
  if [[ -z ${BOATHOOK_CHROME_ARCHIVE-} ]]; then
    curl -fsSL --retry 2 --max-time 180 --output "$archive" "${manifest[3]}" || fail 'Chrome 下载失败，请检查网络或提供已下载的 Chrome ZIP。'
  fi
  [[ -f $archive ]] || fail '找不到 Chrome ZIP，请检查 BOATHOOK_CHROME_ARCHIVE。'
  read -r actual _ < <("${checksum_command[@]}" -- "$archive")
  [[ $actual == "${manifest[4]}" ]] || fail 'Chrome ZIP 校验失败，请重新下载。'
  unzip -q "$archive" -d "$stage"
  mv -- "$stage/${manifest[5]}" "$stage/chrome"
  if [[ $archive == "$stage/chrome.zip" ]]; then rm -- "$archive"; fi
  if [[ $platform == linux-x64 ]]; then
    ldd "$stage/chrome/chrome" > "$stage/libs.txt" || fail '无法读取 Chrome 的系统依赖，请检查 Linux 运行环境。'
    if grep -F 'not found' "$stage/libs.txt" >&2; then fail 'Chrome 缺少上述系统库，请安装后重新运行。'; fi
    rm -- "$stage/libs.txt"
  else
    # Chrome locates its frameworks relative to the executable inside the app.
    cat > "$stage/chrome/chrome" <<'MAC_CHROME_LAUNCHER'
#!/bin/bash
chrome_dir=$(dirname -- "$0")
exec "$chrome_dir/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing" "$@"
MAC_CHROME_LAUNCHER
    chmod 755 "$stage/chrome/chrome"
  fi
  cp -R -- bin licenses scripts install.sh core-checksums.txt manifest.json "$stage/"
  env -u BOATHOOK_CHROME_EXECUTABLE -u BUN_BE_BUN "$stage/bin/boathook" --json doctor
  run_bun -e 'import { renameSync } from "node:fs"; renameSync(process.argv[1], process.argv[2]);' "$stage" "$release"
  trap - EXIT
fi
BOATHOOK_STATE_DIR="$store" run_bun -e '
  const { plugins } = await Bun.file("manifest.json").json();
  const env = { ...process.env, BOATHOOK_SESSION: "" };
  delete env.BUN_BE_BUN;
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
