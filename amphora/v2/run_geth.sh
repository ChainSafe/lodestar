#!/bin/bash

######################
# Update for testnet
BOOTNODE=enode://e95870e55cf62fd3d7091d7e0254d10ead007a1ac64ea071296a603d94694b8d92b49f9a3d3851d9aa95ee1452de8b854e0d5e095ef58cc25e7291e7588f4dfc@35.178.114.73:30303
GETH=geth
######################

# Allow the script to be run from any folder and not break paths
SCRIPT_DIR="$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"

DATA_DIR=${SCRIPT_DIR}/.tmp/geth

# Initialize geth
$GETH --catalyst --datadir $DATA_DIR init ${SCRIPT_DIR}/genesis.json
 
# Run geth
exec $GETH \
  --networkid 1337002 \
  --http \
  --http.addr 0.0.0.0 \
  --http.corsdomain "*" \
  --http.vhosts "*" \
  --catalyst \
  -http.api engine,net,eth \
  --datadir $DATA_DIR \
  --allow-insecure-unlock \
  --bootnodes $BOOTNODE \
  console
