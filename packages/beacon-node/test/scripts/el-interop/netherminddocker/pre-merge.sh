#!/bin/bash -x

scriptDir=$(dirname $0)
currentDir=$(pwd)

. $scriptDir/common-setup.sh

echo "sleeping for 10 seconds..."

docker run --rm --network host --name custom-execution -v $currentDir/$DATA_DIR:/data $EL_BINARY_DIR --datadir /data/nethermind --config themerge_kiln_m2 --Merge.TerminalTotalDifficulty $TTD --JsonRpc.JwtSecretFile /data/jwtsecret --Merge.Enabled true  --Init.DiagnosticMode=None --JsonRpc.Enabled true --JsonRpc.Host 0.0.0.0 --JsonRpc.AdditionalRpcUrls "http://localhost:$ETH_PORT|http|net;eth;subscribe;engine;web3;client|no-auth,http://localhost:$ENGINE_PORT|http|eth;engine" --Sync.SnapSync false
