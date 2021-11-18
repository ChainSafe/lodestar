#!/bin/bash -x

# Parse args to get elPath, ttd, dataDir
. $(dirname "$0")/../parse-args.sh

env TTD=$ttd envsubst < $currentDir/genesisPre.tmpl > $dataDir/genesis.json
echo "45a915e4d060149eb4365960e6a7a45f334393093061116b197e3240065ff2d8" > $dataDir/sk.json
echo "12345678" > $dataDir/password.txt
pubKey="0xa94f5374fce5edbc8e2a8697c15331677e6ebf0b"

$elPath/geth --catalyst --datadir $dataDir init $dataDir/genesis.json
$elPath/geth --catalyst --datadir $dataDir account import $dataDir/sk.json --password $dataDir/password.txt
$elPath/geth --catalyst --http --ws -http.api "engine,net,eth,miner" --datadir $dataDir --allow-insecure-unlock --unlock $pubKey --password $dataDir/password.txt --nodiscover --mine
