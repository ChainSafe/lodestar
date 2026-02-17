#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
REPO_DIR="$(cd -- "$SCRIPT_DIR/../.." &>/dev/null && pwd)"

ENCLAVE_NAME="${ENCLAVE_NAME:-eip8025-devnet}"

echo "=== EIP-8025 Mixed Client Devnet ==="
echo ""

# Step 1: Build Lodestar image (use Dockerfile.dev for faster builds)
echo "1. Building Lodestar Docker image (Dockerfile.dev)..."
cd "$REPO_DIR"
docker build -t lodestar:eip8025 -f Dockerfile.dev .
echo "   Done."

# Step 2: Start kurtosis devnet
echo ""
echo "2. Starting kurtosis devnet (enclave: $ENCLAVE_NAME)..."
kurtosis run github.com/ethpandaops/ethereum-package \
  --enclave "$ENCLAVE_NAME" \
  --args-file "$SCRIPT_DIR/network_params.yaml"

echo ""
echo "3. Devnet is running!"
echo ""
echo "   View services:  kurtosis enclave inspect $ENCLAVE_NAME"
echo "   View logs:      kurtosis service logs $ENCLAVE_NAME <service-name>"
echo ""

# Step 3: Print beacon node URLs
echo "   Beacon node endpoints:"
for svc in $(kurtosis enclave inspect "$ENCLAVE_NAME" 2>/dev/null | grep "cl-" | awk '{print $1}'); do
  url=$(kurtosis port print "$ENCLAVE_NAME" "$svc" http 2>/dev/null || echo "N/A")
  echo "     $svc → $url"
done

echo ""
echo "4. Start the dummy prover against a Lodestar node:"
echo "   node $REPO_DIR/scripts/dummy-prover.mjs --beacon-node <LODESTAR_URL> --proofs-per-block 1"
echo ""
echo "5. Monitor proof gossip in logs:"
echo "   kurtosis service logs $ENCLAVE_NAME <cl-service> | grep -i 'execution.proof\\|zkEVM'"
