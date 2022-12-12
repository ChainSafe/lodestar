#!/usr/bin/env bash

GENESIS_TIME=$(date +%s)

packages/cli/bin/lodestar dev \
  --genesisValidators 8 \
  --startValidators 0..7 \
  --genesisTime $GENESIS_TIME \
  --enr.ip 127.0.0.1 \
  --dataDir .lodestar/node1 \
  --reset \
  --rest \
  --rest.namespace '*' \
  --metrics \
  --logLevel debug \
  --eth1 false \
  --network.requestCountPeerLimit 1000000 \
  --network.blockCountTotalLimit 1000000 \
  --network.blockCountPeerLimit 1000000
