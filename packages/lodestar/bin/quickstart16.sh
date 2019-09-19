TIME=$(node --eval "console.log(Math.floor(Date.now()/1000))")
echo $TIME | tee start_time.txt

./lodestar interop -p minimal --db l2 -q  $TIME,8  --multiaddrs /ip4/127.0.0.1/tcp/30607 -v 8 
