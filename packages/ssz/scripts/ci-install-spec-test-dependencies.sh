#!/bin/bash

WORKDIR=`pwd`
cd ..
git clone -b v0.8.1 https://github.com/chainsafe/eth2.0-spec-tests
git clone -b cayman/v0.8 https://github.com/chainsafe/lodestar
cd lodestar
yarn install
cd $WORKDIR
