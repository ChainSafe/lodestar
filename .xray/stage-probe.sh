#!/usr/bin/env bash
set -euo pipefail
xray_repo=$(realpath "${1:?Usage: .xray/stage-probe.sh /path/to/xray}")
lodestar_repo=$(cd "$(dirname "$0")/.." && pwd)
(
  cd "$xray_repo/clients/js"
  npm ci
  npm run check-types
  npm test
  npm pack --pack-destination "$lodestar_repo/.xray"
)
mv "$lodestar_repo/.xray/xray-probe-0.1.0.tgz" "$lodestar_repo/.xray/probe-0.1.0.tgz"
cd "$lodestar_repo"
pnpm --filter @lodestar/beacon-node add ../../.xray/probe-0.1.0.tgz
node --input-type=module <<'JS'
import {readFileSync, writeFileSync} from "node:fs";
const path = "pnpm-lock.yaml";
const text = readFileSync(path, "utf8");
// pnpm 11 omits the archive location when repacking the same file dependency.
writeFileSync(path, text.replace(/('@xray\/probe@file:\.xray\/probe-0\.1\.0\.tgz':\n    resolution: \{integrity: [^,}]+)(?:, tarball: [^}]+)?\}/, "$1, tarball: file:.xray/probe-0.1.0.tgz}"));
JS
pnpm install --frozen-lockfile
