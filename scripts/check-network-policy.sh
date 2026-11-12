#!/usr/bin/env bash
set -euo pipefail

reference=$(realpath "${1:?usage: scripts/check-network-policy.sh <lodestar-checkout>}")
cd "$(dirname "$0")/.."
fixtures=$PWD/src/network/testdata
revision=$(cat "$fixtures/lodestar-revision")
if [[ $(git -C "$reference" rev-parse HEAD) != "$revision" ]]; then
  echo "Policy fixtures require Lodestar revision $revision" >&2
  exit 1
fi
if ! git -C "$reference" diff --quiet HEAD; then
  echo "Policy fixtures require a clean Lodestar checkout" >&2
  exit 1
fi

generated=$(mktemp -d)
trap 'rm -rf "$generated"' EXIT
for preset in mainnet minimal; do
  (
    cd "$reference"
    LODESTAR_PRESET=$preset node --import tsx packages/beacon-node/test/utils/nativePolicyFixtures.ts "$generated"
  )
  for family in scores subnets; do
    file=application_${family}_${preset}.json
    diff -u "$fixtures/$file" "$generated/$file"
  done
done
