#!/bin/bash -x

# echo a hex encoded 256 bit secret into a file
echo $jwtSecret> $DATA_DIR/jwtsecret
