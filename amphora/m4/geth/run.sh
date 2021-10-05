#!/bin/bash

######################
# Update for testnet
BOOTNODE=enode://ead4b0e2afd49a70ca57a017a59611675ca4464c9d551396711020cea09d6ce974072c7ec0766cc38f4817a33fafcc7f8cbd070feb1ea84e798ee92dfee24675@35.178.114.73:30303
######################

DATA_DIR=/data
PASSWORD_PATH=/password.txt
SK_PATH=/sk.json

PK=0xa94f5374fce5edbc8e2a8697c15331677e6ebf0b
SK=45a915e4d060149eb4365960e6a7a45f334393093061116b197e3240065ff2d8

# Write secret key path
echo "$SK" > $SK_PATH
echo "12345678" > "$PASSWORD_PATH"

# Initialize geth
geth --catalyst --datadir $DATA_DIR init /genesis.json

# Import the signing key (press enter twice for empty password):
geth \
  --catalyst \
  --datadir $DATA_DIR \
  account import $SK_PATH \
  --password $PASSWORD_PATH
 
# Run geth
exec geth \
  --http \
  --http.addr 0.0.0.0 \
  --http.corsdomain "*" \
  --http.vhosts "*" \
  --catalyst \
  -http.api engine,net,eth,miner \
  --datadir $DATA_DIR \
  --allow-insecure-unlock \
  --unlock $PK \
  --password $PASSWORD_PATH \
  --nodiscover \
  # Automatically start mining
  --mine
  --bootnodes $BOOTNODE
