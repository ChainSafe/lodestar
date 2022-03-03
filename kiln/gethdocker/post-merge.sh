#!/bin/bash -x

scriptDir=$(dirname $0)
currentDir=$(pwd)

. $scriptDir/common-setup.sh

docker run --rm -u $(id -u ${USER}):$(id -g ${USER}) --network host -v $currentDir/$DATA_DIR:/data $EL_BINARY_DIR --http --ws -http.api "engine,net,eth" --allow-insecure-unlock --unlock $pubKey --password /data/password.txt --datadir /data --jwt-secret $JWT_SECRET_HEX
