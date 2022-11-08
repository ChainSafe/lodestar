#!/bin/bash -x

echo $TTD
echo $DATA_DIR
echo $EL_BINARY_DIR
echo $JWT_SECRET_HEX
echo $TEMPLATE_FILE

echo $scriptDir
echo $currentDir


env TTD=$TTD envsubst < $scriptDir/$TEMPLATE_FILE > $DATA_DIR/genesis.json
echo "45a915e4d060149eb4365960e6a7a45f334393093061116b197e3240065ff2d8" > $DATA_DIR/sk.json
echo "12345678" > $DATA_DIR/password.txt
pubKey="0xa94f5374fce5edbc8e2a8697c15331677e6ebf0b"

# echo a hex encoded 256 bit secret into a file
echo $JWT_SECRET_HEX> $DATA_DIR/jwtsecret
# clear any previous docker dangling docker run
docker rm -f custom-execution
rm -rf $DATA_DIR/ethereumjs
