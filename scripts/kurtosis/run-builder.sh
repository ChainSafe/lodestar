#!/usr/bin/env bash
set -euo pipefail

# ethereum-package public mnemonic for generating builder keys
MNEMONIC="baby envelope toddler valid pottery buddy cash spare such hedgehog ring ramp item seminar rely select advance knife cruel cereal left father model tissue"

# check dependencies
command -v docker   >/dev/null 2>&1 || { echo "missing dependency docker"; exit 1; }
command -v kurtosis >/dev/null 2>&1 || { echo "missing dependency kurtosis"; exit 1; }

# remove builder and enclave if there are any
docker rm -f lodestar-builder >/dev/null 2>&1 || true
kurtosis enclave rm -f builder-dev 2>/dev/null || true

# settled image name
LODESTAR_IMAGE="local/lodestar:builder-dev"
TEMP="./temp/builder-dev"

# create ./temp/builder-dev
mkdir -p "$TEMP"

DOCKERFILE="${DOCKERFILE:-Dockerfile.dev}"

# build using dockerfile
if [ "${SKIP_BUILD:-0}" != "1" ]; then
  docker build --pull -f "$DOCKERFILE" -t "$LODESTAR_IMAGE" . --build-arg COMMIT="$(git rev-parse HEAD)"
fi

# start devnet, we want to use latest ethereum-package
kurtosis run --enclave builder-dev --args-file ./scripts/kurtosis/builder-dev.yaml github.com/ethpandaops/ethereum-package
# last verified against ethereum-package: 4667e182e0459dee043a2f918d2845d6a66c96a1

if [ ! -d "$TEMP"/derived ]; then
  # derive the builder key
  docker run --rm -v "$(pwd)/$TEMP:/data" \
    protolambda/eth2-val-tools@sha256:46147228f291266148a6a21a2b9541367ad5f70e619d79cd5393459baf539f58 keystores \
    --source-mnemonic="$MNEMONIC" \
    --source-min=0 --source-max=1 \
    --out-loc="/data/derived"
  # isolate keystore and it's password
  cp "$(find "$TEMP"/derived/keys -name voting-keystore.json | head -n1)" "$TEMP"/keystore.json
  cp "$(find "$TEMP"/derived/secrets -type f | head -n1)" "$TEMP"/password.txt
fi

# download network config and jwt secret
kurtosis files download builder-dev el_cl_genesis_data "$TEMP"/netcfg
kurtosis files download builder-dev jwt_file "$TEMP"/jwt

# the builder runs in the devnet network so the beacon node of the validators can reach its builder API,
# it uses the beacon node and execution client of the first participant
docker run -d --name lodestar-builder --network kt-builder-dev \
  -e LODESTAR_PRESET=minimal \
  -v "$(pwd)/$TEMP:/config:ro" \
  -p "127.0.0.1:${BUILDER_METRICS_PORT:-5077}:5065" \
  "$LODESTAR_IMAGE" builder \
  --keystore /config/keystore.json \
  --keystorePassword /config/password.txt \
  --builderPubkey 0x8ec9cc826ea7735329831dbe89c28ae700e39b51c817f1086483621a2104145343f912b3bf167027256780a62a1995bd \
  --beaconNodeUrl http://cl-1-lodestar-geth:4000 \
  --execution.urls http://el-1-geth-lodestar:8551 \
  --execution.jwtSecret /config/jwt/jwtsecret \
  --executionFeeRecipient 0x8943545177806ed17b9f23f0a21ee5948ecaa776 \
  --paramsFile /config/netcfg/config.yaml \
  --builderApi \
  --builderApi.address 0.0.0.0 \
  --builderApi.publicUrl http://lodestar-builder:18550 \
  --metrics \
  --metrics.address 0.0.0.0

echo
echo "devnet and builder up, follow the builder with"
echo
echo "docker logs -f lodestar-builder"
echo
echo "don't forget to clean up later"
echo 'docker rm -f lodestar-builder && kurtosis enclave rm -f builder-dev && kurtosis engine stop'
