#!/bin/bash

# Allow the script to be run from any folder and not break paths
SCRIPT_DIR="$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
LODESTAR_EXECUTABLE=${SCRIPT_DIR}/../../packages/cli/bin/lodestar

LODESTAR_PRESET=minimal $LODESTAR_EXECUTABLE beacon \
  --rcConfig ${SCRIPT_DIR}/rcconfig.yml \
  --rootDir ${SCRIPT_DIR}/.tmp \
  --paramsFile ${SCRIPT_DIR}/config.yaml \
  --genesisStateFile ${SCRIPT_DIR}/genesis.ssz \
  --logFile ${SCRIPT_DIR}/.tmp/beacon.log
