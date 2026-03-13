#!/usr/bin/env bash
# run-devnet-beacon.sh — Start a Lodestar beacon node on any ePBS devnet with engineMock
#
# Usage:
#   ./scripts/run-devnet-beacon.sh [OPTIONS]
#
# Examples:
#   ./scripts/run-devnet-beacon.sh                                    # epbs-devnet-0, default ports
#   ./scripts/run-devnet-beacon.sh --supernode                        # with all custody columns
#   ./scripts/run-devnet-beacon.sh --devnet epbs-devnet-1 --port 9300 # different devnet + port
#   ./scripts/run-devnet-beacon.sh --dry-run                          # print command only
#
# Artifacts are auto-downloaded if missing. For a new devnet, just change --devnet.

set -euo pipefail

DEVNET="epbs-devnet-0"
ARTIFACTS=""
DATA_DIR=""
LOG_DIR=""
PORT=9200
REST_PORT=9700
SUPERNODE=false
LOG_LEVEL=info
EXTRA_FLAGS=""
DRY_RUN=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --devnet)       DEVNET="$2"; shift 2 ;;
    --artifacts)    ARTIFACTS="$2"; shift 2 ;;
    --data-dir)     DATA_DIR="$2"; shift 2 ;;
    --log-dir)      LOG_DIR="$2"; shift 2 ;;
    --port)         PORT="$2"; shift 2 ;;
    --rest-port)    REST_PORT="$2"; shift 2 ;;
    --supernode)    SUPERNODE=true; shift ;;
    --log-level)    LOG_LEVEL="$2"; shift 2 ;;
    --extra-flags)  EXTRA_FLAGS="$2"; shift 2 ;;
    --dry-run)      DRY_RUN=true; shift ;;
    -h|--help)
      sed -n '2,/^$/p' "$0" | sed 's/^# \?//'
      exit 0 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

ARTIFACTS="${ARTIFACTS:-devnet-artifacts/$DEVNET}"
DATA_DIR="${DATA_DIR:-runs/$DEVNET/beacon-data}"
LOG_DIR="${LOG_DIR:-runs/$DEVNET}"

# Auto-download artifacts if missing
if [[ ! -f "$ARTIFACTS/config.yaml" ]] || [[ ! -f "$ARTIFACTS/genesis.ssz" ]]; then
  echo "Downloading artifacts for $DEVNET..."
  mkdir -p "$ARTIFACTS"
  BASE="https://config.${DEVNET}.ethpandaops.io"
  curl -sfL "$BASE/cl/config.yaml" -o "$ARTIFACTS/config.yaml" || { echo "ERROR: failed to download config.yaml from $BASE"; exit 1; }
  curl -sfL "$BASE/cl/genesis.ssz" -o "$ARTIFACTS/genesis.ssz" || { echo "ERROR: failed to download genesis.ssz from $BASE"; exit 1; }
  curl -sfL "$BASE/cl/bootstrap_nodes.txt" -o "$ARTIFACTS/bootstrap_nodes.txt" 2>/dev/null || echo "(no bootstrap_nodes.txt)"
  curl -sfL "$BASE/api/v1/nodes/inventory" -o "$ARTIFACTS/inventory.json" 2>/dev/null || true
  echo "Artifacts saved to $ARTIFACTS/"
fi

BOOTNODES=""
if [[ -f "$ARTIFACTS/bootstrap_nodes.txt" ]]; then
  BOOTNODES=$(tr '\n' ',' < "$ARTIFACTS/bootstrap_nodes.txt" | sed 's/,$//')
fi

mkdir -p "$DATA_DIR" "$LOG_DIR"

CMD=(
  node --max-old-space-size=8192
  packages/cli/bin/lodestar.js beacon
  --paramsFile "$ARTIFACTS/config.yaml"
  --genesisStateFile "$ARTIFACTS/genesis.ssz"
  --dataDir "$DATA_DIR"
  --rest --rest.port "$REST_PORT"
  --port "$PORT"
  --logLevel "$LOG_LEVEL"
  --logFile "$LOG_DIR/beacon.log"
  --logFileLevel debug
  --execution.engineMock
  --eth1=false
  --network.connectToDiscv5Bootnodes
  --disablePeerScoring
  --persistNetworkIdentity
)

[[ -n "$BOOTNODES" ]] && CMD+=(--bootnodes "$BOOTNODES")
[[ "$SUPERNODE" == true ]] && CMD+=(--supernode)
# shellcheck disable=SC2206
[[ -n "$EXTRA_FLAGS" ]] && CMD+=($EXTRA_FLAGS)

echo "=== Lodestar Beacon Node ==="
echo "Devnet:    $DEVNET"
echo "Artifacts: $ARTIFACTS"
echo "Data:      $DATA_DIR"
echo "Logs:      $LOG_DIR/beacon.log"
echo "Ports:     libp2p=$PORT rest=$REST_PORT"
echo "Supernode: $SUPERNODE"
echo ""

if [[ "$DRY_RUN" == true ]]; then
  echo "[DRY RUN] ${CMD[*]}"
  exit 0
fi

echo "Starting... (PID file: $LOG_DIR/beacon.pid)"
nohup "${CMD[@]}" > "$LOG_DIR/run.out" 2>&1 &
PID=$!
echo "$PID" > "$LOG_DIR/beacon.pid"
echo "Started with PID $PID"
echo ""
echo "Monitor:"
echo "  tail -f $LOG_DIR/run.out"
echo "  curl -s http://127.0.0.1:$REST_PORT/eth/v1/node/syncing | jq"
echo ""
echo "Stop:"
echo "  kill \$(cat $LOG_DIR/beacon.pid)"
