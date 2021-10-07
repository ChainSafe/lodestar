#!/bin/bash

DATA_DIR=/data

# Initialize geth
geth --catalyst --datadir $DATA_DIR init /genesis.json
 
# Run geth
exec geth \
  --http \
  --http.addr 0.0.0.0 \
  --http.corsdomain "*" \
  --http.vhosts "*" \
  --catalyst \
  -http.api engine,net,eth \
  --datadir $DATA_DIR \
  --allow-insecure-unlock \
  --bootnodes $BOOTNODE
