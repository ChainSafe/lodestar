export LODESTAR_PRESET=minimal
for f in ./test/simulation/*.test.ts; 
do 
  echo "Running $f";
  if ! ts-node --esm ${f} then
    exit 1
  fi
done;