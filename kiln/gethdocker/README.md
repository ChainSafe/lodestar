# Geth Docker setup for running the sim merge tests on local machine

###### Geth docker image
Pull the latest `geth` image from the dockerhub

```bash
docker pull ethereum/client-go:latest
```

###### Run test scripts

```bash
cd packages/lodestar
EL_BINARY_DIR=ethereum/client-go:latest EL_SCRIPT_DIR=kiln/gethdocker ETH_PORT=8545 ENGINE_PORT=8551 TX_SCENARIOS=simple yarn mocha test/sim/merge-interop.test.ts
```
