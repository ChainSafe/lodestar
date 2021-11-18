#!/bin/bash -x

# Parse args to get elPath, ttd, dataDir
. $(dirname "$0")/../parse-args.sh

env TTD=$ttd envsubst < $currentDir/genesisPost.tmpl > $dataDir/genesis.json
$elPath/geth --catalyst --datadir $dataDir init $dataDir/genesis.json
$elPath/geth --catalyst --http --ws -http.api "engine,net,eth" --datadir $dataDir
