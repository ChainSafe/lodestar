#!/usr/bin/env bash
set -euo pipefail

# ethereum-package public mnemonic for generating builder keys
MNEMONIC="baby envelope toddler valid pottery buddy cash spare such hedgehog ring ramp item seminar rely select advance knife cruel cereal left father model tissue"

# check dependencies
command -v docker   >/dev/null 2>&1 || { echo "missing dependency docker"; exit 1; }
command -v kurtosis >/dev/null 2>&1 || { echo "missing dependency kurtosis"; exit 1; }

# remove enclave if there is one
kurtosis enclave rm -f builder-dev 2>/dev/null || true

# settled image name
LODESTAR_IMAGE="local/lodestar:builder-dev"

# build image if there isn't one
if ! docker image inspect "$LODESTAR_IMAGE" >/dev/null 2>&1; then
  docker build -t "$LODESTAR_IMAGE" .
fi
# start devnet
kurtosis run --enclave builder-dev --args-file ./scripts/kurtosis/builder-dev.yaml github.com/ethpandaops/ethereum-package
# made at ethereum-package commit: 5ec41d44ae23fb01b036c11b25d98547cc9c3be4

# assemble ./test-builder
if [ ! -d "./test-builder" ]; then
  # derive builder key
  docker run --rm -v "$(pwd)/temp:/data" \
    protolambda/eth2-val-tools:latest keystores \
    --source-mnemonic="$MNEMONIC" \
    --source-min=0 --source-max=1 \
    --out-loc="/data/builder-keys"
  # move into the dir
  mkdir -p ./temp/test-builder
  cp "$(find ./temp/builder-keys/keys -name voting-keystore.json | head -n1)" ./temp/test-builder/keystore.json
  cp "$(find ./temp/builder-keys/secrets -type f | head -n1)" ./temp/test-builder/password.txt
fi

# download network config
kurtosis files download builder-dev el_cl_genesis_data ./temp/netcfg

# builder running note
echo
echo "devnet up. run the sidecar in another terminal:"
echo
echo 'LODESTAR_PRESET=minimal ./lodestar builder \'
echo '  --keystore ./temp/test-builder/keystore.json \'
echo '  --keystorePassword ./temp/test-builder/password.txt \'
echo '  --builderPubkey 0x8ec9cc826ea7735329831dbe89c28ae700e39b51c817f1086483621a2104145343f912b3bf167027256780a62a1995bd \'
# make sure to place the correct url
echo '  --beaconNodeUrl "http://127.0.0.1:37001" \'
echo '  --executionFeeRecipient 0x8943545177806ed17b9f23f0a21ee5948ecaa776 \'
echo '  --paramsFile ./temp/netcfg/config.yaml'
echo
echo "don't forget to clean up later"
echo 'kurtosis enclave rm -f builder-dev && kurtosis engine stop'
