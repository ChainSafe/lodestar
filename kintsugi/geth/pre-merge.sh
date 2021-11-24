#!/bin/bash -x

scriptDir=$(dirname $0)
. $scriptDir/common-setup.sh

$EL_BINARY_DIR/geth --catalyst --http --ws -http.api "engine,net,eth,miner" --datadir $DATA_DIR --allow-insecure-unlock --unlock $pubKey --password $DATA_DIR/password.txt --nodiscover --mine
