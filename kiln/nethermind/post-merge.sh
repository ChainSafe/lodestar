#!/bin/bash -x

cd $EL_BINARY_DIR
dotnet run -c Release -- --config themerge_kiln_testvectors --Merge.TerminalTotalDifficulty $TTD
