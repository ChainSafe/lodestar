START_TIME=$(cat genesistime.txt)
cat $START_TIME
./lodestar interop -p minimal --db l2 -q $START_TIME,8  --multiaddrs /ip4/0.0.0.0/tcp/30607 
