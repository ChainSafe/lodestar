START_TIME=$(date +%s)
echo $START_TIME > genesistime.txt
cat $START_TIME
./lodestar interop -p minimal --db l1 -q $START_TIME,8 --multiaddrs /ip4/0.0.0.0/tcp/30606 -v 8  
