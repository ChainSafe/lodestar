#!/bin/bash -x

scriptDir=$(dirname $0)

echo $TTD
echo $DATA_DIR
echo $scriptDir
echo $EL_BINARY_DIR

env TTD=$TTD envsubst < $scriptDir/genesisPost.tmpl > $DATA_DIR/genesis.json
$EL_BINARY_DIR/geth --catalyst --datadir $DATA_DIR init $DATA_DIR/genesis.json
$EL_BINARY_DIR/geth --catalyst --http --ws -http.api "engine,net,eth" --datadir $DATA_DIR
