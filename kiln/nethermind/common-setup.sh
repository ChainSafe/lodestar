#!/bin/bash -x

# echo a hex encoded 256 bit secret into a file
jwtSecret=${JWT_SECRET_HEX/#"0x"}
echo $jwtSecret> $DATA_DIR/jwtsecret
