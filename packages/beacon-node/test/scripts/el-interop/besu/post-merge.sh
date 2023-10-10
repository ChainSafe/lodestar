#!/bin/bash -x

scriptDir=$(dirname $0)
currentDir=$(pwd)

. $scriptDir/common-setup.sh

$EL_BINARY_DIR/besu --engine-rpc-enabled --rpc-http-enabled --rpc-http-api ADMIN,ETH,MINER,NET --rpc-http-port $ETH_PORT --engine-rpc-port $ENGINE_PORT --engine-jwt-secret $currentDir/$DATA_DIR/jwtsecret --data-path $DATA_DIR  --data-storage-format BONSAI --genesis-file $DATA_DIR/genesis.json