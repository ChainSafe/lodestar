#!/bin/bash -x

# Parse args to get elPath, ttd, dataDir
. $(dirname "$0")/../parse-args.sh

# First arg is binarypath
cd $elPath
dotnet run -c Release -- --config themerge_kintsugi_testvectors --Merge.TerminalTotalDifficulty $ttd