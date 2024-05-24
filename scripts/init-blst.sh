#!/bin/bash

SCRIPT_DIR=$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )

cd "$SCRIPT_DIR/../node_modules/@chainsafe/blst"

git clone git@github.com:supranational/blst.git

npm i --ignore-scripts

npm run clean

npm run build