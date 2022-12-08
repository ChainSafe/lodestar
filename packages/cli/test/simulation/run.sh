export LODESTAR_PRESET=minimal
for f in ./test/simulation/*.test.ts; 
do 
  echo "Running $f";
  ts-node --esm ${f} || break;
done;