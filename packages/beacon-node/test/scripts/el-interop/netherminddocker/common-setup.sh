#!/bin/bash -x

echo $TTD
echo $DATA_DIR
echo $EL_BINARY_DIR
echo $JWT_SECRET_HEX

echo $scriptDir
echo $currentDir

# echo a hex encoded 256 bit secret into a file
echo $JWT_SECRET_HEX> $DATA_DIR/jwtsecret

echo "clear any previous docker dangling docker run"
docker rm -f custom-execution
rm -rf $DATA_DIR/nethermind
