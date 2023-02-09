#!/bin/bash -x

scriptDir=$(dirname $0)
currentDir=$(pwd)

. $scriptDir/common-setup.sh

docker run --rm -u $(id -u ${USER}):$(id -g ${USER}) --name custom-execution --network host -v $currentDir/$DATA_DIR:/data $EL_BINARY_DIR --dataDir /data/ethereumjs --gethGenesis /data/genesis.json --rpc --rpcEngine --jwt-secret /data/jwtsecret --logLevel debug
