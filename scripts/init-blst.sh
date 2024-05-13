#!/bin/bash

SCRIPT_DIR=$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )

cd "$SCRIPT_DIR/../node_modules/@chainsafe/blst"

git clone git@github.com:supranational/blst.git

rm -rf prebuild

npm i --ignore-scripts

node_modules/.bin/node-gyp configure

npm run build:gyp