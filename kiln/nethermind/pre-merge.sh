#!/bin/bash -x

. $scriptDir/common-setup.sh

cd $EL_BINARY_DIR
dotnet run -c Release -- --config themerge_kiln_m2 --Merge.TerminalTotalDifficulty $TTD --JsonRpc.JwtSecretFile $DATA_DIR/jwtsecret 
