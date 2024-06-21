#!/bin/bash

cd node_modules/c-kzg

git clone https://github.com/supranational/blst.git

cd bindings/node.js

make build

