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
TEMP="./temp/builder-dev"

# create ./temp/builder-dev
mkdir -p "$TEMP"

# build image if there isn't one
if ! docker image inspect "$LODESTAR_IMAGE" >/dev/null 2>&1; then
  docker build -t "$LODESTAR_IMAGE" .
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

# download network config
kurtosis files download builder-dev el_cl_genesis_data "$TEMP"/netcfg

# builder running note
echo
echo "devnet up. run the sidecar in another terminal:"
echo
echo 'LODESTAR_PRESET=minimal ./lodestar builder \'
echo '  --keystore ./temp/builder-dev/keystore.json \'
echo '  --keystorePassword ./temp/builder-dev/password.txt \'
echo '  --builderPubkey 0x8ec9cc826ea7735329831dbe89c28ae700e39b51c817f1086483621a2104145343f912b3bf167027256780a62a1995bd \'
# make sure to place the correct url
echo '  --beaconNodeUrl "http://127.0.0.1:37001" \'
echo '  --executionFeeRecipient 0x8943545177806ed17b9f23f0a21ee5948ecaa776 \'
echo '  --paramsFile ./temp/builder-dev/netcfg/config.yaml'
echo
echo "don't forget to clean up later"
echo 'kurtosis enclave rm -f builder-dev && kurtosis engine stop'
