#!/bin/bash -x

scriptDir=$(dirname $0)
currentDir=$(pwd)

. $scriptDir/common-setup.sh

docker run --rm -u $(id -u ${USER}):$(id -g ${USER}) --name custom-execution -p $ETH_PORT:$ETH_PORT -p $ENGINE_PORT:$ENGINE_PORT -v $currentDir/$DATA_DIR:/data $EL_BINARY_DIR --http --http.addr 0.0.0.0 -http.api "engine,net,eth,miner" --http.port $ETH_PORT --authrpc.port $ENGINE_PORT --authrpc.addr 0.0.0.0 --authrpc.jwtsecret /data/jwtsecret --allow-insecure-unlock --unlock $pubKey --password /data/password.txt --datadir /data/geth --syncmode full
