#!/bin/bash -x

scriptDir=$(dirname $0)
currentDir=$(pwd)

. $scriptDir/common-setup.sh

cd $EL_BINARY_DIR/

docker run --network host $EL_BINARY_DIR relay --listen-addr 127.0.0.1:$ETH_PORT --engine-listen-addr 127.0.0.1:$ENGINE_PORT --log.level debug --genesis-validators-root 0x3e8bd71d9925794b4f5e8623e15094ea6edc0fd206e3551e13dd2d10e08fbaba 
# tail -F anything