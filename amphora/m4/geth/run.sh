#!/bin/bash

######################
# Update for testnet
BOOTNODE=enode://ead4b0e2afd49a70ca57a017a59611675ca4464c9d551396711020cea09d6ce974072c7ec0766cc38f4817a33fafcc7f8cbd070feb1ea84e798ee92dfee24675@35.178.114.73:30303
######################

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
  --unlock $PK \
  --nodiscover \
  --bootnodes $BOOTNODE
