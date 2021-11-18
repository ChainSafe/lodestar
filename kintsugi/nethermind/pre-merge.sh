#!/bin/bash -x

cd $EL_BINARY_DIR
dotnet run -c Release -- --config themerge_kintsugi_m2 --Merge.TerminalTotalDifficulty $TTD
