# Lodestar Simulation Test

Lodestar simulation tests allows to setup a small, local devnet for the variety of Consensus and Execution Layer clients. We use the `minimal` preset for all CL clients. Following clients are currently supported.

**EL CLinents**

1. Geth
2. Nethermind
3. Mock (only for specific use case testing)

**CL Clients**

1. Lodestar (local source code build)
2. Lighthouse

## Setup and configurations

You can run any of npm task prefixed with `test:sim:*`. There are different scenarios which are currently configured for sim tests. You can find under `test/sim`. Use following env variables to configure the clients runtime.

| Client     | Variable                | Purpose                                                                                                                                                                                                               |
| ---------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Geth       | GETH_DOCKER_IMAGE       | Use it if you want to run the Geth in the docker. Preferred approach.                                                                                                                                                 |
| Geth       | GETH_BINARY_DIR         | If you want to test something locally which is not yet published on Geth, you can set this variable to point to geth binary directory. Remember point it to directory containing `geth` binary not the binary itself. |
| Nethermind | NETHERMIND_DOCKER_IMAGE | Use it to set the Nethermind docker image. Currently only docker is supported for this client.                                                                                                                        |
| Lighthouse | LIGHTHOUSE_DOCKER_IMAGE | Similar to other clients use it to set Lighouse docker image. Make use you use `-dev` suffixed image tags as these are the only one supporting `minimal` preset.                                                      |
| Lighthouse | LIGHTHOUSE_BINARY_PATH  | Use local compiled binary. Make sure it's compiled with the `minimal` spec enabled.                                                                                                                                   |

## Architecture

Based on the parameters passed to `SimulationEnvironment.initWithDefaults` the following directory structure is created by the `SimulationEnvironment` and passed relevant directories to the individual client generators. For understanding we call this process as bootstrapping.

```bash
# Here multi-fork is the simulation id 
/tmp/random-directory/multi-fork
  /node-1
    /cl-${client}
      genesis.ssz
      jwtsecret.txt
      /validators
        # Contains all validators definition with relative path 
        validator_definitions.yml
        /secrets 
          # Public key prefixed password for keystore decrypiton
          0x18302981aadffccc123313.txt
        /keystores
          # Public key prefixed with 0x, EIP-2335 keystore file
          0x18302981aadffccc123313.json
    /el-${client}
      genesis.json
      jwtsecret.txt

# Here multi-fork is the simulation id
$logsDir/multi-fork/
  docker_runner.log
  node-1-cl-${client}.log
  node-1-cl-${client}-validator.log
  node-1-el-${client}.log
```

### Running a client in docker

It's upto individual client generator how to run it. Can be specified with `type` property of the job options returned from the generator. Currently `RunnerType.Docker` and `RunnerType.ChildProcess` are supported.

The above directories structure for individual client will be passed to the generator, it's upto generator to decide how to mount on docker and use relative paths.

### Considerations to keep in mind

1. The jobs are executed on host machine, so job `bootstrap` and `teardown` actions should be using real paths not the mounted ones.
2. Similarly `health` endpoint for reach job also execute on the host machine, so it should use `127.0.0.1` or `localhost`.
3. If there is a specific port required to expose from the docker job, must specify in the job options. 

