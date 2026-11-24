#!/bin/sh
set -eu
source_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
workspace=$1
version=${2:-24.22.2}
export PATH="$workspace/node-v$version-linux-x64/bin:$PATH"
export PLAYWRIGHT_BROWSERS_PATH="$workspace/browsers"
cd "$workspace/project"
printf 'Linux browser workspace: %s\n' "$workspace"
npx playwright install --only-shell chromium
npm run test:browser
mkdir -p "$source_dir/artifacts"
cp "$workspace/project/artifacts/browser-demo.png" "$source_dir/artifacts/browser-linux.png"
