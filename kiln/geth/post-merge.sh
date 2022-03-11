#!/bin/bash -x

scriptDir=$(dirname $0)
currentDir=$(pwd)

. $scriptDir/common-setup.sh

$EL_BINARY_DIR/geth --http --ws -http.api "engine,net,eth" --datadir $DATA_DIR --allow-insecure-unlock --unlock $pubKey --password $DATA_DIR/password.txt --jwt-secret $JWT_SECRET_HEX
