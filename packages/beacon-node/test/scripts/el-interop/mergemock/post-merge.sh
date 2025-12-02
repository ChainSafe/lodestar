#!/bin/bash -x

scriptDir=$(dirname $0)
currentDir=$(pwd)

. $scriptDir/common-setup.sh

# if we don't provide any datadir merge mock stores data in memory which is fine by us
docker run --rm -u $(id -u ${USER}):$(id -g ${USER}) --name custom-execution --network host -v $currentDir/$DATA_DIR/genesis.json:/usr/app/genesis.json -v $currentDir/$DATA_DIR/jwtsecret:/usr/app/jwt.hex $EL_BINARY_DIR relay --listen-addr 127.0.0.1:$ETH_PORT --engine-listen-addr 127.0.0.1:$ENGINE_PORT --log.level debug --genesis-validators-root 0x3e8bd71d9925794b4f5e8623e15094ea6edc0fd206e3551e13dd2d10e08fbaba
