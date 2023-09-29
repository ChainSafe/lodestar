#!/bin/bash -x

scriptDir=$(dirname $0)
currentDir=$(pwd)

. $scriptDir/common-setup.sh

$EL_BINARY_DIR/besu --engine-rpc-enabled --rpc-http-enabled --rpc-http-api ETH,MINER,NET --rpc-http-port $ETH_PORT --engine-jwt-secret /data/jwtsecret --data-path /data/besu --data-storage-format BONSAI --genesis-file /data/genesis.json 