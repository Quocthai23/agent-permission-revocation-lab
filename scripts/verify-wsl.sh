#!/bin/sh
# Run from WSL: sh /mnt/c/Research/scripts/verify-wsl.sh 22.19.0
# Keeps a disposable Linux checkout and its logs for inspection; no system install.
set -eu
version=${1:-22.19.0}
case "$version" in *[!0-9.]*|'') echo 'Use a numeric Node version' >&2; exit 1;; esac
source_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
workspace=$(mktemp -d /tmp/permission-lab-linux.XXXXXX)
mkdir -p "$source_dir/artifacts"
printf '%s\n' "$workspace" > "$source_dir/artifacts/wsl-workspace-$version.txt"
curl --fail --silent --show-error --max-time 120 "https://nodejs.org/dist/v$version/node-v$version-linux-x64.tar.xz" -o "$workspace/node.tar.xz"
curl --fail --silent --show-error --max-time 30 "https://nodejs.org/dist/v$version/SHASUMS256.txt" -o "$workspace/SHASUMS256.txt"
expected=$(awk -v name="node-v$version-linux-x64.tar.xz" '$2==name {print $1}' "$workspace/SHASUMS256.txt")
printf '%s  %s\n' "$expected" "$workspace/node.tar.xz" | sha256sum --check --status
tar -xJf "$workspace/node.tar.xz" -C "$workspace"
export PATH="$workspace/node-v$version-linux-x64/bin:$PATH"
mkdir "$workspace/project"
tar -C "$source_dir" --exclude=./node_modules --exclude=./.pilot --exclude=./dist --exclude=./docs/api --exclude=./artifacts --exclude=./.env --exclude='./.env.*' -cf - . | tar -C "$workspace/project" -xf -
cd "$workspace/project"
node --version
npm ci --no-fund
npm run verify > "$workspace/verify.log" 2>&1 || {
  cp "$workspace/verify.log" "$source_dir/artifacts/verify-linux-node${version%%.*}.log"
  cat "$workspace/verify.log"; exit 1;
}
cp "$workspace/verify.log" "$source_dir/artifacts/verify-linux-node${version%%.*}.log"
cat "$workspace/verify.log"
if [ "${2:-}" = "--browser" ]; then
  sh "$source_dir/scripts/test-wsl-browser.sh" "$workspace" "$version"
fi
printf 'Linux checkout and log: %s\n' "$workspace"
