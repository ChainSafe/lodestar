#!/usr/bin/env bash

# Fetch node1 data
ENR=$(curl -s http://localhost:9596/eth/v1/node/identity | jq .data.enr)
GENESIS_TIME=$(curl -s http://localhost:9596/eth/v1/beacon/genesis | jq .data.genesis_time)

packages/cli/bin/lodestar dev \
  --genesisValidators 8 \
  --genesisTime $GENESIS_TIME \
  --enr.ip 127.0.0.1 \
  --rootDir .lodestar/node2 \
  --reset \
  --api.rest.enabled \
  --api.rest.api '*' \
  --metrics.enabled \
  --metrics.serverPort 8009 \
  --logLevel debug \
  --eth1.enabled false \
  --port 9001 \
  --api.rest.port 9597 \
  --network.connectToDiscv5Bootnodes true \
  --network.discv5.bootEnrs $ENR