#!/bin/bash

./lodestar dev --genesisValidators 32 --startValidators 0:31 \
  --api.rest.enabled --api.rest.host 0.0.0.0 \
  --logFile beacon.log --logLevelFile debug --logRotate --logMaxFiles 5 \
  --params.ALTAIR_FORK_EPOCH 0 \
  --params.MERGE_FORK_EPOCH 0 \
  --params.TERMINAL_TOTAL_DIFFICULTY 0 \
  --genesisEth1Hash "0xa0513a503d5bd6e89a144c3268e5b7e9da9dbf63df125a360e3950a7d0d67131" \
  --execution.urls http://localhost:8550

