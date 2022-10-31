#!/bin/bash -x

scriptDir=$(dirname $0)
currentDir=$(pwd)

. $scriptDir/common-setup.sh

$EL_BINARY_DIR/geth --http -http.api "engine,net,eth,miner" --http.port $ETH_PORT --authrpc.port $ENGINE_PORT --authrpc.jwtsecret $currentDir/$DATA_DIR/jwtsecret --datadir $DATA_DIR --allow-insecure-unlock --unlock $pubKey --password $DATA_DIR/password.txt --syncmode full