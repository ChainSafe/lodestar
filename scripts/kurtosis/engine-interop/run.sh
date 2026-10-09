#!/usr/bin/env bash
# Runs one execution client against two Lodestar nodes on a kurtosis devnet and checks the engine API interop.
#
# usage: run.sh <el_type> <el_image> <fulu|gloas>
#   LODESTAR_IMAGE   consensus client image (default chainsafe/lodestar:next)
#   EL_EXTRA_PARAMS  json array of extra EL flags (default [])
#   OUT_DIR          where logs, metrics and the verdict are written (default ./temp/engine-interop/<el>-<scenario>)
#   KEEP=1           keep the enclave running after the checks
#
# fulu: electra and fulu at genesis, finality 3, then the second EL is restarted and finality has to advance again.
# gloas: fulu at genesis and gloas at epoch 2, finality 5, archived payload envelopes rebuilt from EL bodies.
set -euo pipefail

EL_TYPE=$1
EL_IMAGE=$2
SCENARIO=$3
LODESTAR_IMAGE=${LODESTAR_IMAGE:-chainsafe/lodestar:next}
EL_EXTRA_PARAMS=${EL_EXTRA_PARAMS:-[]}
OUT_DIR=${OUT_DIR:-./temp/engine-interop/$EL_TYPE-$SCENARIO}
ENCLAVE=${ENCLAVE:-engine-interop-$EL_TYPE-$SCENARIO}
# we want the latest ethereum-package, last verified against 98f1dfbe11fc0fac630bf9cf1ac3a9951abce809
ETHEREUM_PACKAGE=${ETHEREUM_PACKAGE:-github.com/ethpandaops/ethereum-package}
SPAMOOR_IMAGE=${SPAMOOR_IMAGE:-ethpandaops/spamoor:master}
# funded by the ethereum-package genesis
SPAMOOR_PRIVKEY=bcdf20249abf0ed6d944c0288fad489e33f66b3960d9e6229c1cd214ed3bbe31
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

command -v docker >/dev/null 2>&1 || { echo "missing dependency docker"; exit 1; }
command -v kurtosis >/dev/null 2>&1 || { echo "missing dependency kurtosis"; exit 1; }
command -v node >/dev/null 2>&1 || { echo "missing dependency node"; exit 1; }

case "$SCENARIO" in
  fulu) FORKS=$'  electra_fork_epoch: 0\n  fulu_fork_epoch: 0'; FINALITY_TARGET=3 ;;
  gloas) FORKS=$'  electra_fork_epoch: 0\n  fulu_fork_epoch: 0\n  gloas_fork_epoch: 2'; FINALITY_TARGET=5 ;;
  *) echo "unknown scenario $SCENARIO"; exit 1 ;;
esac

mkdir -p "$OUT_DIR"
OUT_DIR="$(cd "$OUT_DIR" && pwd)"
log() { echo "[$EL_TYPE/$SCENARIO] $*"; }

cat > "$OUT_DIR/args.yaml" <<YAML
participants:
  - el_type: $EL_TYPE
    el_image: $EL_IMAGE
    el_extra_params: $EL_EXTRA_PARAMS
    cl_type: lodestar
    cl_image: $LODESTAR_IMAGE
    cl_extra_params: ["--logLevelModule=execution=debug"]
    supernode: false
  - el_type: $EL_TYPE
    el_image: $EL_IMAGE
    el_extra_params: $EL_EXTRA_PARAMS
    cl_type: lodestar
    cl_image: $LODESTAR_IMAGE
    cl_extra_params: ["--logLevelModule=execution=debug"]
    supernode: true
network_params:
  preset: minimal
$FORKS
  seconds_per_slot: 6
  num_validator_keys_per_node: 64
additional_services: []
# fixed host ports below the ephemeral range, so neither the first bind nor a container restart races the kernel for them
port_publisher:
  el:
    enabled: true
    public_port_start: 20000
  cl:
    enabled: true
    public_port_start: 21000
snooper_params:
  enabled: false
persistent: true
YAML

on_exit() {
  local code=$1
  if [ "$code" != "0" ]; then
    # a failure before the verdict still gets a summary row and the enclave contents for the artifacts
    [ -f "$OUT_DIR/summary.md" ] || echo "| $EL_TYPE | \`$EL_IMAGE\` | $SCENARIO | | | ❌ fail | run aborted before the verdict, see the run log |" > "$OUT_DIR/summary.md"
    kurtosis enclave dump "$ENCLAVE" "$OUT_DIR/enclave-dump" >/dev/null 2>&1 || true
  fi
  docker rm -f "spamoor-$ENCLAVE" >/dev/null 2>&1 || true
  if [ "${KEEP:-0}" != "1" ]; then
    kurtosis enclave rm -f "$ENCLAVE" >/dev/null 2>&1 || true
  fi
  exit "$code"
}
trap 'on_exit $?' EXIT

container() { docker ps --filter "network=kt-$ENCLAVE" --format '{{.Names}}' | grep "^$1" | head -1; }
port() { docker port "$1" "$2/tcp" | head -1 | sed 's/.*://'; }
beacon() { curl -sf --max-time 5 "http://127.0.0.1:$API2$1"; }
finalized() { beacon /eth/v1/beacon/states/head/finality_checkpoints | node -pe 'JSON.parse(require("fs").readFileSync(0)).data.finalized.epoch' 2>/dev/null || echo 0; }
wait_finalized() {
  local target=$1 budget=$2 start fin
  start=$(date +%s)
  while :; do
    fin=$(finalized)
    [ "${fin:-0}" -ge "$target" ] && return 0
    [ $(( $(date +%s) - start )) -ge "$budget" ] && { log "finalized epoch $fin after ${budget}s, wanted $target"; return 1; }
    sleep 10
  done
}
snapshot() {
  for n in 1 2; do
    curl -sf --max-time 5 "http://127.0.0.1:$(port "$(container cl-$n-lodestar)" 8008)/metrics" > "$OUT_DIR/metrics-$1-cl$n.txt"
  done
  date -u +%Y-%m-%dT%H:%M:%S.000Z > "$OUT_DIR/snapshot-$1.time"
}

# floating tags must mean the latest build, kurtosis would otherwise reuse whatever the host already has
docker pull -q "$LODESTAR_IMAGE" > /dev/null
docker pull -q "$EL_IMAGE" > /dev/null
LODESTAR_VERSION=$(docker run --rm --entrypoint node "$LODESTAR_IMAGE" /usr/app/packages/cli/bin/lodestar.js --version 2>/dev/null | sed -n 's/.*Version: //p' | head -1)
log "starting enclave $ENCLAVE ($EL_IMAGE, lodestar $LODESTAR_IMAGE ${LODESTAR_VERSION:-unknown version})"
# kurtosis occasionally loses track of the short-lived key generation service while bringing the enclave up
# ("has Docker resources but not a container"), a fresh engine and a second attempt get past it
for attempt in 1 2; do
  kurtosis enclave rm -f "$ENCLAVE" >/dev/null 2>&1 || true
  if kurtosis run --enclave "$ENCLAVE" "$ETHEREUM_PACKAGE" --args-file "$OUT_DIR/args.yaml" > "$OUT_DIR/kurtosis-run.log" 2>&1; then
    break
  fi
  if [ "$attempt" = "2" ]; then
    log "kurtosis run failed twice, see kurtosis-run.log"
    tail -40 "$OUT_DIR/kurtosis-run.log"
    exit 1
  fi
  log "kurtosis run failed, restarting the engine and retrying"
  cp "$OUT_DIR/kurtosis-run.log" "$OUT_DIR/kurtosis-run-attempt1.log"
  kurtosis enclave rm -f "$ENCLAVE" >/dev/null 2>&1 || true
  kurtosis engine restart >/dev/null 2>&1 || true
done

CL1=$(container cl-1-lodestar); CL2=$(container cl-2-lodestar); EL1=$(container el-1-); EL2=$(container el-2-)
if [ -z "$CL1" ] || [ -z "$CL2" ] || [ -z "$EL1" ] || [ -z "$EL2" ]; then
  log "containers missing: cl1=$CL1 cl2=$CL2 el1=$EL1 el2=$EL2"
  exit 1
fi
API2=$(port "$CL2" 4000)
GENESIS_TIME=$(beacon /eth/v1/beacon/genesis | node -pe 'JSON.parse(require("fs").readFileSync(0)).data.genesis_time')

# the package's own spammer does not survive startup, run the blob scenario by hand against the second EL
docker run -d --rm --name "spamoor-$ENCLAVE" --network "kt-$ENCLAVE" "$SPAMOOR_IMAGE" blobs \
  --privkey "$SPAMOOR_PRIVKEY" --rpchost "http://$EL2:8545" --fulu-activation "$GENESIS_TIME" \
  --throughput 3 --sidecars 2 --slot-duration 6s > /dev/null
log "blob spammer started against $EL2"

# everything before the first finalized epoch is startup noise and not judged
wait_finalized 1 300
snapshot start
log "finalized epoch 1, judging from here"

RESTART_SLOT=""
wait_finalized "$FINALITY_TARGET" 600
snapshot end
log "finalized epoch $(finalized)"

if [ "$SCENARIO" = "fulu" ]; then
  RESTART_SLOT=$(beacon /eth/v1/beacon/headers/head | node -pe 'JSON.parse(require("fs").readFileSync(0)).data.header.message.slot')
  log "restarting $EL2 at slot $RESTART_SLOT"
  date -u +%Y-%m-%dT%H:%M:%S.000Z > "$OUT_DIR/restart.time"
  docker restart "$EL2" > /dev/null
  # judge again once node 2 sees its EL back and in sync, plus one REST re-probe interval
  start=$(date +%s)
  until [ "$(beacon /eth/v1/node/syncing | node -pe 'const d=JSON.parse(require("fs").readFileSync(0)).data; d.el_offline === false && d.is_optimistic === false' 2>/dev/null)" = "true" ]; do
    [ $(( $(date +%s) - start )) -ge 240 ] && { log "$EL2 did not come back within 240s"; exit 1; }
    sleep 5
  done
  sleep 12
  beacon /eth/v1/beacon/headers/head | node -pe 'JSON.parse(require("fs").readFileSync(0)).data.header.message.slot' > "$OUT_DIR/restart-end.slot"
  log "$EL2 back after $(( $(date +%s) - start ))s, head slot $(cat "$OUT_DIR/restart-end.slot")"
  snapshot restart
  wait_finalized $(( FINALITY_TARGET + 1 )) 240
  snapshot after-restart
  log "finality advanced after the restart"
fi

docker logs -t "$CL1" > "$OUT_DIR/cl1.log" 2>&1
docker logs -t "$CL2" > "$OUT_DIR/cl2.log" 2>&1
docker logs -t "$EL1" > "$OUT_DIR/el1.log" 2>&1
docker logs -t "$EL2" > "$OUT_DIR/el2.log" 2>&1
docker logs "spamoor-$ENCLAVE" > "$OUT_DIR/spamoor.log" 2>&1 || true

JWT_SECRET=$(docker exec "$CL1" cat /jwt/jwtsecret)
EL_TYPE="$EL_TYPE" EL_IMAGE="$EL_IMAGE" SCENARIO="$SCENARIO" OUT_DIR="$OUT_DIR" JWT_SECRET="$JWT_SECRET" \
  LODESTAR_IMAGE="$LODESTAR_IMAGE" LODESTAR_VERSION="${LODESTAR_VERSION:-}" \
  API1="$(port "$CL1" 4000)" API2="$API2" METRICS1="$(port "$CL1" 8008)" METRICS2="$(port "$CL2" 8008)" \
  ENGINE1="$(port "$EL1" 8551)" RPC1="$(port "$EL1" 8545)" RESTART_SLOT="$RESTART_SLOT" \
  node "$SCRIPT_DIR/check.mjs"
