#!/usr/bin/env bash
# Runs Lodestar and one other consensus client as mixed beacon node / validator client pairs on a kurtosis devnet and
# checks that they interoperate.
#
# usage: run.sh <client> <bn_image> <vc_image> <fulu|gloas>
#   node 1 is a Lodestar beacon node without validators that serves as the bootnode, node 2 is the other client's
#   beacon node driving a Lodestar validator client, node 3 is a Lodestar beacon node driving the other client's
#   validator client. Pass "-" as <bn_image> for a client without a beacon node (vero), node 2 is then Lodestar on
#   both sides, and "-" as <vc_image> for a client the package cannot run as a separate validator client (grandine),
#   node 3 is then Lodestar on both sides.
#   LODESTAR_IMAGE   Lodestar image for the beacon nodes and the validator client (default chainsafe/lodestar:next)
#   EL_IMAGE         geth image behind every beacon node (default ethpandaops/geth:master)
#   OUT_DIR          where logs, metrics and the verdict are written (default ./temp/cl-interop/<client>-<scenario>)
#   KEEP=1           keep the enclave running after the checks
#
# fulu: electra and fulu at genesis, finality 4.
# gloas: fulu at genesis and gloas at epoch 2, finality 5.
set -euo pipefail

CLIENT=$1
BN_IMAGE=$2
VC_IMAGE=$3
SCENARIO=$4
LODESTAR_IMAGE=${LODESTAR_IMAGE:-chainsafe/lodestar:next}
EL_IMAGE=${EL_IMAGE:-ethpandaops/geth:master}
OUT_DIR=${OUT_DIR:-./temp/cl-interop/$CLIENT-$SCENARIO}
ENCLAVE=${ENCLAVE:-cl-interop-$CLIENT-$SCENARIO}
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
  fulu) FORKS=$'  electra_fork_epoch: 0\n  fulu_fork_epoch: 0'; FINALITY_TARGET=4 ;;
  gloas) FORKS=$'  electra_fork_epoch: 0\n  fulu_fork_epoch: 0\n  gloas_fork_epoch: 2'; FINALITY_TARGET=5 ;;
  *) echo "unknown scenario $SCENARIO"; exit 1 ;;
esac

if [ "$BN_IMAGE" = "-" ]; then BN_TYPE=lodestar; BN_IMAGE=$LODESTAR_IMAGE; else BN_TYPE=$CLIENT; fi
if [ "$VC_IMAGE" = "-" ]; then VC_TYPE=lodestar; VC_IMAGE=$LODESTAR_IMAGE; else VC_TYPE=$CLIENT; fi
# the package starts a web3signer for clients without their own keystore loading
REMOTE_SIGNER=false
[ "$VC_TYPE" = "vero" ] && REMOTE_SIGNER=true
BN_HTTP_PORT=4000
[ "$BN_TYPE" = "prysm" ] && BN_HTTP_PORT=3500
# with so few peers most subnets have nobody to publish to, so every beacon node subscribes to all of them
subscribe_all_subnets() {
  case "$1" in
    lodestar) echo "--subscribeAllSubnets" ;;
    teku) echo "--p2p-subscribe-all-subnets-enabled=true" ;;
    *) echo "--subscribe-all-subnets" ;;
  esac
}
# the verdict reads finalized states for the attestation participation of every validator
LODESTAR_BN_PARAMS='["--subscribeAllSubnets", "--serveHistoricalState", "--logLevelModule=api=debug,rest=debug"]'
BN_PARAMS="[\"$(subscribe_all_subnets "$BN_TYPE")\"]"
[ "$BN_TYPE" = "lodestar" ] && BN_PARAMS=$LODESTAR_BN_PARAMS
# the nimbus validator client exits on its own epoch 0 block proposal while status-im/nimbus-eth2#9278 is open
VC_PARAMS='[]'
[ "$VC_TYPE" = "nimbus" ] && VC_PARAMS='["--doppelganger-detection=off"]'

mkdir -p "$OUT_DIR"
OUT_DIR="$(cd "$OUT_DIR" && pwd)"
# leftovers of an earlier run must not end up in this verdict, anything else in there is not ours to delete
if [ -n "$(ls -A "$OUT_DIR")" ] && [ ! -f "$OUT_DIR/args.yaml" ] && [ ! -f "$OUT_DIR/summary.md" ]; then
  echo "refusing to clean $OUT_DIR, not the output of an earlier run"
  exit 1
fi
find "$OUT_DIR" -mindepth 1 -maxdepth 1 ! -name args.yaml -exec rm -rf {} +
log() { echo "[$CLIENT/$SCENARIO] $*"; }

dump_logs() { [ -n "$1" ] && docker logs -t "$1" > "$OUT_DIR/$2" 2>&1 || true; }
capture_logs() {
  dump_logs "${CL_BOOT:-}" bn1-bootnode-lodestar.log
  dump_logs "${CL_X:-}" "bn2-$BN_TYPE.log"
  dump_logs "${VC_LS:-}" vc2-lodestar.log
  dump_logs "${CL_LS:-}" bn3-lodestar.log
  dump_logs "${VC_X:-}" "vc3-$VC_TYPE.log"
  dump_logs "${EL_BOOT:-}" el1.log
  dump_logs "${EL_X:-}" el2.log
  dump_logs "${EL_LS:-}" el3.log
  dump_logs "${SIGNER_X:-}" signer3.log
  docker logs "spamoor-$ENCLAVE" > "$OUT_DIR/spamoor.log" 2>&1 || true
}

on_exit() {
  local code=$1
  # a failing command in here must not cut the cleanup short
  set +e +o pipefail
  if [ "$code" != "0" ]; then
    # a failure before the verdict still gets a summary row with the reason, the container logs, a last metrics
    # snapshot and the enclave contents for the artifacts
    if [ ! -f "$OUT_DIR/result.json" ]; then
      capture_logs
      [ -n "${METRICS_LSVC:-}" ] && snapshot abort
    fi
    if [ ! -f "$OUT_DIR/summary.md" ]; then
      local reason="run aborted before the verdict, see the run log"
      if [ -f "$OUT_DIR/abort.reason" ]; then
        reason=$(cat "$OUT_DIR/abort.reason")
      elif [ -f "$OUT_DIR/kurtosis-run.log" ] && ! grep -q "starting enclave done" "$OUT_DIR/.progress" 2>/dev/null; then
        # the service that failed and the first error from its own logs, not the generic Starlark wrapper lines
        reason="enclave did not start: $(grep -oE "starting or updating the following services: '[^']*'|(ValueError|fail|panic|Error|error): [^\"]{0,200}" "$OUT_DIR/kurtosis-run.log" | grep -vE "Starlark|instruction \(number|starting or updating.*\] *$" | head -2 | tr '\n' ' ')"
      fi
      # the reason becomes the summary row, a known issue keeps the job green
      if CLIENT="$CLIENT" BN_TYPE="${BN_TYPE:-}" VC_TYPE="${VC_TYPE:-}" BN_IMAGE="$BN_IMAGE" VC_IMAGE="$VC_IMAGE" SCENARIO="$SCENARIO" OUT_DIR="$OUT_DIR" \
        BN_DIGEST="${BN_DIGEST:-}" VC_DIGEST="${VC_DIGEST:-}" ABORT_REASON="$reason" node "$SCRIPT_DIR/check.mjs"; then
        code=0
      fi
    fi
    kurtosis enclave dump "$ENCLAVE" "$OUT_DIR/enclave-dump" >/dev/null 2>&1 || true
  fi
  docker rm -f "spamoor-$ENCLAVE" >/dev/null 2>&1 || true
  if [ "${KEEP:-0}" != "1" ]; then
    kurtosis enclave rm -f "$ENCLAVE" >/dev/null 2>&1 || true
  fi
  exit "$code"
}
trap 'on_exit $?' EXIT

# Floating tags must mean the latest build. The host may already have an older image under the same tag and a
# registry mirror may still serve an older manifest for it, so resolve the tag at the registry and pull by digest.
resolve() {
  local raw digest=""
  # the manifest digest is the sha256 of the raw manifest (or index) bytes as served by the registry
  raw=$(docker buildx imagetools inspect "$1" --raw 2>/dev/null) && [ -n "$raw" ] && digest="sha256:$(printf '%s' "$raw" | sha256sum | cut -c1-64)"
  if [ -n "$digest" ]; then echo "${1%%@*}"; echo "$digest"; else echo "$1"; echo ""; fi
}
ref() { local repo=$1 digest=$2 image=$3; if [ -n "$digest" ]; then echo "${repo%%:*}@$digest"; else echo "$image"; fi; }
{ read -r LODESTAR_REPO; read -r LODESTAR_DIGEST; } < <(resolve "$LODESTAR_IMAGE")
{ read -r EL_REPO; read -r EL_DIGEST; } < <(resolve "$EL_IMAGE")
{ read -r BN_REPO; read -r BN_DIGEST; } < <(resolve "$BN_IMAGE")
{ read -r VC_REPO; read -r VC_DIGEST; } < <(resolve "$VC_IMAGE")
LODESTAR_REF=$(ref "$LODESTAR_REPO" "$LODESTAR_DIGEST" "$LODESTAR_IMAGE")
EL_REF=$(ref "$EL_REPO" "$EL_DIGEST" "$EL_IMAGE")
BN_REF=$(ref "$BN_REPO" "$BN_DIGEST" "$BN_IMAGE")
VC_REF=$(ref "$VC_REPO" "$VC_DIGEST" "$VC_IMAGE")
for image in "$LODESTAR_REF" "$EL_REF" "$BN_REF" "$VC_REF"; do docker pull -q "$image" > /dev/null; done
LODESTAR_VERSION=$(docker run --rm --entrypoint node "$LODESTAR_REF" /usr/app/packages/cli/bin/lodestar.js --version 2>/dev/null | sed -n 's/.*Version: //p' | head -1 || true)
cat > "$OUT_DIR/args.yaml" <<YAML
participants:
  # the first node is the bootnode of the package and a second Lodestar view of the other client
  - el_type: geth
    el_image: $EL_REF
    cl_type: lodestar
    cl_image: $LODESTAR_REF
    cl_extra_params: ["--subscribeAllSubnets"]
    validator_count: 0
    supernode: true
  - el_type: geth
    el_image: $EL_REF
    cl_type: $BN_TYPE
    cl_image: $BN_REF
    cl_extra_params: $BN_PARAMS
    use_separate_vc: true
    vc_type: lodestar
    vc_image: $LODESTAR_REF
    vc_log_level: debug
    supernode: false
  - el_type: geth
    el_image: $EL_REF
    cl_type: lodestar
    cl_image: $LODESTAR_REF
    cl_extra_params: $LODESTAR_BN_PARAMS
    use_separate_vc: true
    use_remote_signer: $REMOTE_SIGNER
    vc_type: $VC_TYPE
    vc_image: $VC_REF
    vc_extra_params: $VC_PARAMS
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
  vc:
    enabled: true
    public_port_start: 22000
snooper_params:
  enabled: false
persistent: true
YAML


container() { docker ps -a --filter "network=kt-$ENCLAVE" --format '{{.Names}}' | grep "^$1" | head -1 || true; }
# a validator client that exited explains a dead half of the network better than any chain metric
container_states() {
  local out="" name
  for name in "$BN_TYPE bn:$CL_X" "lodestar vc:$VC_LS" "lodestar bn:$CL_LS" "$VC_TYPE vc:$VC_X"; do
    out="$out${out:+, }${name%%:*} $(docker inspect -f '{{.State.Status}}{{if ne .State.ExitCode 0}} exit {{.State.ExitCode}}{{end}}' "${name#*:}" 2>/dev/null || echo gone)"
  done
  echo "$out"
}
port() { docker port "$1" "$2/tcp" | head -1 | sed 's/.*://'; }
json() { node -pe "const d=JSON.parse(require('fs').readFileSync(0)); $1"; }
beacon() { curl -sf --max-time 5 "http://127.0.0.1:$1$2"; }
head_slot() { beacon "$1" /eth/v1/beacon/headers/head | json 'd.data.header.message.slot' 2>/dev/null || echo 0; }
finalized() { beacon "$API_LS" /eth/v1/beacon/states/head/finality_checkpoints | json 'd.data.finalized.epoch' 2>/dev/null || echo 0; }
wait_finalized() {
  local target=$1 budget=$2 start fin
  start=$(date +%s)
  while :; do
    fin=$(finalized)
    [ "${fin:-0}" -ge "$target" ] && return 0
    if [ $(( $(date +%s) - start )) -ge "$budget" ]; then
      log "finalized epoch $fin after ${budget}s, wanted $target"
      echo "finalized epoch $fin after ${budget}s, wanted $target (head $(head_slot "$API_LS") on lodestar bn, $(head_slot "$API_X") on $BN_TYPE bn; $(container_states))" > "$OUT_DIR/abort.reason"
      return 1
    fi
    sleep 10
  done
}
snapshot() {
  local who
  for who in "lsbn:$METRICS_LS" "lsvc:$METRICS_LSVC"; do
    if ! curl -sf --max-time 5 "http://127.0.0.1:${who#*:}/metrics" > "$OUT_DIR/metrics-$1-${who%%:*}.txt"; then
      [ -f "$OUT_DIR/abort.reason" ] || echo "metrics of lodestar ${who%%:*} unreachable at snapshot $1 ($(container_states))" > "$OUT_DIR/abort.reason"
      return 1
    fi
  done
  # the bootnode is not judged, its peer counters tell who dropped whom when the others lose each other
  curl -sf --max-time 5 "http://127.0.0.1:$METRICS_BOOT/metrics" > "$OUT_DIR/metrics-$1-bootnode.txt" || true
  [ "$BN_TYPE" = "lodestar" ] && { curl -sf --max-time 5 "http://127.0.0.1:$METRICS_X/metrics" > "$OUT_DIR/metrics-$1-xbn.txt" || true; }
  date -u +%Y-%m-%dT%H:%M:%S.000Z > "$OUT_DIR/snapshot-$1.time"
}
log "starting enclave $ENCLAVE (lodestar $LODESTAR_IMAGE ${LODESTAR_DIGEST:0:19} ${LODESTAR_VERSION:-unknown version}, $BN_TYPE bn $BN_IMAGE ${BN_DIGEST:0:19}, $VC_TYPE vc $VC_IMAGE ${VC_DIGEST:0:19}, geth $EL_IMAGE ${EL_DIGEST:0:19})"
# kurtosis occasionally loses track of the short-lived key generation service while bringing the enclave up
# ("has Docker resources but not a container"), a second attempt gets past it. In CI nothing else runs on the engine,
# so it is restarted in between as well
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
  log "kurtosis run failed, retrying"
  cp "$OUT_DIR/kurtosis-run.log" "$OUT_DIR/kurtosis-run-attempt1.log"
  kurtosis enclave rm -f "$ENCLAVE" >/dev/null 2>&1 || true
  [ -n "${CI:-}" ] && kurtosis engine restart >/dev/null 2>&1 || true
done
echo "starting enclave done" > "$OUT_DIR/.progress"

CL_BOOT=$(container cl-1-); CL_X=$(container cl-2-); CL_LS=$(container cl-3-); VC_LS=$(container vc-2-); VC_X=$(container vc-3-)
EL_BOOT=$(container el-1-); EL_X=$(container el-2-); EL_LS=$(container el-3-); SIGNER_X=$(container signer-3-)
if [ -z "$CL_BOOT" ] || [ -z "$CL_X" ] || [ -z "$CL_LS" ] || [ -z "$VC_LS" ] || [ -z "$VC_X" ] || [ -z "$EL_X" ] || [ -z "$EL_LS" ]; then
  log "containers missing: boot=$CL_BOOT x_bn=$CL_X ls_bn=$CL_LS ls_vc=$VC_LS x_vc=$VC_X el_x=$EL_X el_ls=$EL_LS"
  exit 1
fi
API_LS=$(port "$CL_LS" 4000); API_X=$(port "$CL_X" "$BN_HTTP_PORT")
METRICS_LS=$(port "$CL_LS" 8008); METRICS_BOOT=$(port "$CL_BOOT" 8008); METRICS_X=""; [ "$BN_TYPE" = "lodestar" ] && METRICS_X=$(port "$CL_X" 8008)
METRICS_LSVC=$(port "$VC_LS" 8080)
GENESIS_TIME=$(beacon "$API_LS" /eth/v1/beacon/genesis | json 'd.data.genesis_time')
LS_PEER_ID=$(beacon "$API_LS" /eth/v1/node/identity | json 'd.data.peer_id')
X_PEER_ID=$(beacon "$API_X" /eth/v1/node/identity | json 'd.data.peer_id')

# the package's own spammer does not survive startup, run the blob scenario by hand against the execution clients of
# both nodes with validators so both propose blocks with blobs
docker run -d --rm --name "spamoor-$ENCLAVE" --network "kt-$ENCLAVE" "$SPAMOOR_IMAGE" blobs \
  --privkey "$SPAMOOR_PRIVKEY" --rpchost "http://$EL_X:8545" --rpchost "http://$EL_LS:8545" --fulu-activation "$GENESIS_TIME" \
  --throughput 3 --sidecars 2 --slot-duration 6s > /dev/null
log "blob spammer started against $EL_X and $EL_LS"

# everything before the first finalized epoch is startup noise and not judged
wait_finalized 1 420
snapshot start
log "finalized epoch $(finalized), judging from here"

wait_finalized "$FINALITY_TARGET" 600
snapshot end
log "finalized epoch $(finalized)"

capture_logs

CLIENT="$CLIENT" BN_TYPE="$BN_TYPE" VC_TYPE="$VC_TYPE" BN_IMAGE="$BN_IMAGE" VC_IMAGE="$VC_IMAGE" SCENARIO="$SCENARIO" OUT_DIR="$OUT_DIR" \
  LODESTAR_IMAGE="$LODESTAR_IMAGE" LODESTAR_VERSION="${LODESTAR_VERSION:-}" LODESTAR_DIGEST="${LODESTAR_DIGEST:-}" \
  BN_DIGEST="${BN_DIGEST:-}" VC_DIGEST="${VC_DIGEST:-}" EL_IMAGE="$EL_IMAGE" EL_DIGEST="${EL_DIGEST:-}" \
  API_LS="$API_LS" API_X="$API_X" LS_PEER_ID="$LS_PEER_ID" X_PEER_ID="$X_PEER_ID" \
  node "$SCRIPT_DIR/check.mjs"
