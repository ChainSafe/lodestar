# Geth Docker setup for running the sim merge tests on local machine

###### Build geth docker image
Or directly use a compatible pre-build image (checkout `./Dockerfile` for the compatible branch of `geth`)

```bash
cd kiln/gethdocker
docker build  . --tag geth:kiln
```

###### Run test scripts

```bash
cd packages/lodestar
EL_BINARY_DIR=geth:kiln EL_SCRIPT_DIR=kiln/gethdocker ETH_PORT=8545 ENGINE_PORT=8551 TX_SCENARIOS=simple yarn mocha test/sim/merge-interop.test.ts
```
