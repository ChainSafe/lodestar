#!/bin/bash -x

# Parse args to get elPath, ttd, dataDir
. $(dirname "$0")/../parse-args.sh

cd $elPath
dotnet run -c Release -- --config themerge_kintsugi_m2 --Merge.TerminalTotalDifficulty $ttd
