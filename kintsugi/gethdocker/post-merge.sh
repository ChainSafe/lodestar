#!/bin/bash -x

scriptDir=$(dirname $0)
. $scriptDir/common-setup.sh

docker run --rm -u $(id -u ${USER}):$(id -g ${USER}) --network host -v /mnt/code/lodestar/mergetest/packages/lodestar/$DATA_DIR:/data $EL_BINARY_DIR geth  --catalyst --http --ws -http.api "engine,net,eth" --allow-insecure-unlock --unlock $pubKey --password /data/password.txt --datadir /data
