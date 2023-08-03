#!/usr/bin/env bash

# Fetch node1 data
ENR=$(curl -s http://localhost:9596/eth/v1/node/identity | jq -r .data.enr)
GENESIS_TIME=$(curl -s http://localhost:9596/eth/v1/beacon/genesis | jq -r .data.genesis_time)

./lodestar dev \
  --genesisValidators 8 \
  --genesisTime $GENESIS_TIME \
  --enr.ip 127.0.0.1 \
  --dataDir .lodestar/node2 \
  --reset \
  --rest \
  --rest.namespace '*' \
  --metrics \
  --metrics.port 8009 \
  --logLevel debug \
  --eth1 false \
  --port 9001 \
  --rest.port 9597 \
  --network.connectToDiscv5Bootnodes true \
  --bootnodes $ENR
