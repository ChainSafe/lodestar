#!/usr/bin/env bash
# Usage: run.sh <locally built mainnet Lodestar image> <Assertoor image>
# SCENARIO=interleaved runs the gist fixture with 12-second slots and a fourth, TS observer node.
# OUT_DIR, ENCLAVE, SLOT_SECONDS and DEPOSITS customize this isolated local stress run.
# The playbook adapts jtraglia/assertoor's s5 at f588c88bee10b12af0400fd716571bb6ab7eb418
# to the 0xb0 builder prefix. It generates distinct, well-formed wrong-message signatures.
# Build Assertoor from that commit for the host architecture; its published image is arm64 only.
set -euo pipefail

LODESTAR_IMAGE=${1:?pass a locally built mainnet Lodestar image}
ASSERTOOR_IMAGE=${2:-local/assertoor:deposit-cache-f588c88b}
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
DEPOSIT_RUN_ID=$(date +%s)
OUT_DIR=${OUT_DIR:-/tmp/lodestar-deposit-cache-$DEPOSIT_RUN_ID}
ENCLAVE=${ENCLAVE:-lodestar-deposit-cache-$DEPOSIT_RUN_ID}
DEPOSITS=${DEPOSITS:-50000}
SCENARIO=${SCENARIO:-prefix}
case "$SCENARIO" in
  prefix) NODE_COUNT=3; SLOT_SECONDS=${SLOT_SECONDS:-6}; FORK_EPOCH=3 ;;
  interleaved) NODE_COUNT=4; SLOT_SECONDS=${SLOT_SECONDS:-12}; FORK_EPOCH=4; DEPOSITS=16281 ;;
  *) echo "SCENARIO must be prefix or interleaved"; exit 1 ;;
esac
PACKAGE_COMMIT=5795b77e65235ad223d4d3b413b2739190bf60cc
EL_IMAGE=ethpandaops/geth@sha256:1325b54ff6ed20d123411e3e351b75e36b1867ba03afc098f21e8e7214453976
GENESIS_IMAGE=ethpandaops/ethereum-genesis-generator@sha256:71d91a284216673cc5ec8ef5dca877ac2f5c35a4c508e0cfc70f2d1bd76b19e7

[[ "$DEPOSITS" =~ ^[0-9]+$ ]] && ((DEPOSITS > 0 && DEPOSITS <= 250000)) || { echo "DEPOSITS must be 1..250000"; exit 1; }
[[ "$SLOT_SECONDS" =~ ^[0-9]+$ ]] && ((SLOT_SECONDS >= 6 && SLOT_SECONDS <= 12)) || { echo "SLOT_SECONDS must be 6..12"; exit 1; }
docker image inspect "$LODESTAR_IMAGE" >/dev/null
HOST_ARCH=$(docker info --format '{{.Architecture}}')
case "$HOST_ARCH" in x86_64) HOST_ARCH=amd64 ;; aarch64) HOST_ARCH=arm64 ;; esac
IMAGES=("$LODESTAR_IMAGE")
if [ "$SCENARIO" = prefix ]; then IMAGES+=("$ASSERTOOR_IMAGE"); fi
for image in "${IMAGES[@]}"; do
  [ "$(docker image inspect "$image" --format '{{.Architecture}}')" = "$HOST_ARCH" ] || { echo "image architecture mismatch: $image"; exit 1; }
done
mkdir -p "$OUT_DIR"
[ ! -e "$OUT_DIR/observations.jsonl" ] || { echo "use a fresh OUT_DIR to preserve earlier results"; exit 1; }
if [ ! -d "$OUT_DIR/ethereum-package" ]; then
  gh api "repos/ethpandaops/ethereum-package/tarball/$PACKAGE_COMMIT" > "$OUT_DIR/package.tar.gz"
  mkdir "$OUT_DIR/ethereum-package"
  tar -xzf "$OUT_DIR/package.tar.gz" --strip-components=1 -C "$OUT_DIR/ethereum-package"
fi
if [ "$SCENARIO" = prefix ]; then
  cp "$SCRIPT_DIR/prefix.yaml" "$OUT_DIR/ethereum-package/static_files/assertoor-config/tests/deposit-cache.yaml"
else
  mkdir -p "$OUT_DIR/contract"
  XDG_CACHE_HOME="$OUT_DIR/compiler-cache" pnpm --config.store-dir="$OUT_DIR/compiler-store" dlx solc@0.8.30 \
    --optimize --bin --abi -o "$OUT_DIR/contract" "$SCRIPT_DIR/InterleavedDeposit.sol"
fi
cat > "$OUT_DIR/args.yaml" <<EOF
participants:
  - el_type: geth
    el_image: $EL_IMAGE
    cl_type: lodestar
    cl_image: $LODESTAR_IMAGE
    vc_type: lodestar
    vc_image: $LODESTAR_IMAGE
    validator_count: 128
    cl_extra_params: ["--chain.nativeStateTransition=true", "--subscribeAllSubnets", "--serveHistoricalState"]
  - el_type: geth
    el_image: $EL_IMAGE
    cl_type: lodestar
    cl_image: $LODESTAR_IMAGE
    vc_type: lodestar
    vc_image: $LODESTAR_IMAGE
    validator_count: 128
    cl_extra_params: ["--chain.nativeStateTransition=false", "--subscribeAllSubnets", "--serveHistoricalState"]
  - el_type: geth
    el_image: $EL_IMAGE
    cl_type: lodestar
    cl_image: $LODESTAR_IMAGE
    validator_count: 0
    cl_extra_params: ["--chain.nativeStateTransition=true", "--subscribeAllSubnets", "--serveHistoricalState"]
EOF
if [ "$SCENARIO" = interleaved ]; then
  cat >> "$OUT_DIR/args.yaml" <<EOF
  - el_type: geth
    el_image: $EL_IMAGE
    cl_type: lodestar
    cl_image: $LODESTAR_IMAGE
    validator_count: 0
    cl_extra_params: ["--chain.nativeStateTransition=false", "--subscribeAllSubnets", "--serveHistoricalState"]
EOF
fi
cat >> "$OUT_DIR/args.yaml" <<EOF
network_params:
  network_id: "3151942"
  seconds_per_slot: $SLOT_SECONDS
  slot_duration_ms: $((SLOT_SECONDS * 1000))
  genesis_delay: 60
  genesis_gaslimit: 250000000
  electra_fork_epoch: 0
  fulu_fork_epoch: 0
  gloas_fork_epoch: $FORK_EPOCH
EOF
if [ "$SCENARIO" = interleaved ]; then
  cat >> "$OUT_DIR/args.yaml" <<'EOF'
  prefunded_accounts: '{"0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266": {"balance": "1000000ETH"}}'
additional_services: []
EOF
else
  cat >> "$OUT_DIR/args.yaml" <<EOF
additional_services: [assertoor]
assertoor_params:
  image: $ASSERTOOR_IMAGE
  tests:
    - file: /tests/deposit-cache.yaml
      config:
        invalidDeposits: $DEPOSITS
EOF
fi
cat >> "$OUT_DIR/args.yaml" <<EOF
global_log_level: debug
ethereum_genesis_generator_params:
  image: $GENESIS_IMAGE
EOF
kurtosis run --enclave "$ENCLAVE" "$OUT_DIR/ethereum-package" --args-file "$OUT_DIR/args.yaml" | tee "$OUT_DIR/kurtosis.log"
capture_logs() {
  for ((index=1; index<=NODE_COUNT; index++)); do
    kurtosis service logs --all "$ENCLAVE" "cl-$index-lodestar-geth" > "$OUT_DIR/node-$index.log" 2>&1 || true
  done
  if [ "$SCENARIO" = prefix ]; then
    kurtosis service logs --all "$ENCLAVE" assertoor > "$OUT_DIR/assertoor.log" 2>&1 || true
  fi
}
trap capture_logs EXIT
ENDPOINTS=()
CL_ENDPOINTS=()
for ((index=1; index<=NODE_COUNT; index++)); do
  CL_ENDPOINTS+=("$(kurtosis port print "$ENCLAVE" "cl-$index-lodestar-geth" http)")
  ENDPOINTS+=("${CL_ENDPOINTS[-1]}")
  ENDPOINTS+=("$(kurtosis port print "$ENCLAVE" "cl-$index-lodestar-geth" metrics)/metrics")
done
if [ "$SCENARIO" = interleaved ]; then
  EL_ENDPOINT=$(kurtosis port print "$ENCLAVE" el-1-geth-lodestar rpc)
  if [[ "$EL_ENDPOINT" != http*://* ]]; then EL_ENDPOINT="http://$EL_ENDPOINT"; fi
  node "$SCRIPT_DIR/interleaved.mjs" "$OUT_DIR" "$EL_ENDPOINT" "${CL_ENDPOINTS[@]}" | tee "$OUT_DIR/interleaved.log"
fi
node "$SCRIPT_DIR/check.mjs" "$OUT_DIR" "$DEPOSITS" "${ENDPOINTS[@]}" | tee "$OUT_DIR/check.log"
echo "Results: $OUT_DIR/result.json"
