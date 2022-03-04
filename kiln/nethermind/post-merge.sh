#!/bin/bash -x

scriptDir=$(dirname $0)
. $scriptDir/common-setup.sh

cd $EL_BINARY_DIR
dotnet run -c Release -- --config themerge_kiln_testvectors --Merge.TerminalTotalDifficulty $TTD --JsonRpc.JwtSecretFile $DATA_DIR/jwtsecret
