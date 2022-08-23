#!/bin/bash -x

# echo a hex encoded 256 bit secret into a file
echo $JWT_SECRET_HEX> $DATA_DIR/jwtsecret
