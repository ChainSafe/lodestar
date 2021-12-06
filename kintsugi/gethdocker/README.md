# Geth Docker setup for running the sim merge tests on local machine

###### Build geth docker image
```bash
cd kintsugi/gethdocker
docker build  . --tag geth:kintsugi
```

###### Run test scripts
```bash
cd packages/lodestar
EL_BINARY_DIR=geth:kintsugi EL_SCRIPT_DIR=gethdocker EL_PORT=8545 TX_SCENARIOS=simple yarn mocha test/sim/merge-interop.test.ts
```
