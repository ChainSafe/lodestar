# Simulation Testing

"Sim" testing for Lodestar is the most comprehensive, and complex, testing that is run.  The goal is to fully simulate a testnet and to actuate the code in a way that closely mimics what will happen when turning on Lodestar in the wild.  This is a very complex task and requires a lot of moving parts to work together.  The following sections will describe the various components and how they work together.

At a very high level, simulation testing will setup a testnet from genesis and let proceed through "normal" execution exactly as the nodes would under production circumstances. To get feedback there are regular checks along the way to asses how the testnet nodes are working. These "assertions" can be added and removed at will to allow developers to check for specific conditions in a tightly controlled, reproducible, environment to get high quality and actionable feedback on how Lodestar performs. The end goal of these tests is to to run a full Lodestar client in an environment that is as close to what an end user would experience.  

These tests usually setup full testnets with multiple consensus clients and their paired execution node. In many instance we are looking to just exercise the Lodestar code but there are some places where there is also testing to see how Lodestar works in relation to the other consensus clients, like Lighthouse. As you can imagine, there is quite a bit of machinery that is responsible for setting up and managing the simulations and assertions. This section will help to go over those bits and pieces.  Many, but not all, of these classes can be found in `packages/cli/test/utils/simulation`.

## Sim Test Infrastructure

When setting up and running the simulations, interactions with the nodes is through the published node API's. All functionality is actuated via http request and by "plugging in" this way it is possible to run the nodes in a stand-alone fashion, as they would be run in production, but to still achieve a tightly monitored and controlled environment.  If code needs to be executed on a "class by class" basis or with mocking involved then the test is not a simulation test and would fall into one of the other testing categories. See the [Testing](../testing.md) page for more information on the other types of tests available for Lodestar.

### Simulation Environment

The simulation environment has many pieces and those are orchestrated by the `SimulationEnvironment` class.  The testnet nodes will be run as a mixture of Docker containers and bare metal code execution via Node.js.  In order to monitor the various clients there is a `SimulationTracker` that's primary function is to `register` assertions that will track and gauge how the nodes are doing during the simulation.  See the section on [Simulation Assertions](#simulation-assertions) below for more information on them.  There is an `EpochClock` that has helper functions related to timing of slots and epochs and there is also a `Runner` that will help to start/stop the various Docker container and spawn the Node.js child processes as necessary.

The `SimulationEnvironment` is the orchestrator for all the various functions to great the test net and start it from genesis.  It is also how the various forks are configured to exercise code through various fork transitions.

### Simulation Assertions

These are the secret sauce for making the simulation tests meaningful.  There are several predefined assertions that can be added to a simulation tracker and one can also create custom assertions and add them to the environment.  Assertions can be added per slot, per epoch, per fork or per node.  They can even be added to check conditions across nodes.

Assertions are added to the `SimulationTracker` with the `register` method and the tracker follows the environment to make sure that assertions are run at the appropriate times, and on the correct targets.

Assertions are implemented via API calls to the various targets and meta from the API calls is stored and used to assert that the desired conditions were met. Any information that can be retrieved via API call can be added to the assertion `stores` for validation, and validations can be asserted at a specific time or on an interval.

There are a number of assertions that are added to simulations by default.  They are:

- `inclusionDelayAssertion`
- `attestationsCountAssertion`
- `attestationParticipationAssertion`
- `connectedPeerCountAssertion`
- `finalizedAssertion`
- `headAssertion`
- `missedBlocksAssertion`
- `syncCommitteeParticipationAssertion`

Because of the flexibility, and complexity, there is a section specifically for how to create custom assertions below.  See [custom assertions](#custom-assertions) for more info.

### Simulation Reports

### Simulation Logging

## Running Sim Tests

There are a number of sim tests that are available and each has a slightly different purpose.  All are run by CI and must pass for a PR to be valid for merging.

### `test:sim:multifork`

The multifork sim test checks that Lodestar is capable of moving through all forks in a testnet.  Lodestar is tested with Geth and Nethermind as the execution client.  It also checks a Lighthouse/Geth node for cross client compatibility.  The test is run in several phases where each epoch is responsible for different actions. The phases of the test are as follows:

- Epoch 1

`GETH_DOCKER_IMAGE=ethereum/client-go:v1.11.6 LIGHTHOUSE_DOCKER_IMAGE=sigp/lighthouse:latest-amd64-modern-dev NETHERMIND_DOCKER_IMAGE=nethermind/nethermind:1.18.0 yarn test:sim:multifork`

### `packages/cli`

- `yarn test:sim:mixedclient`
- `yarn test:sim:endpoints`
- `yarn test:sim:deneb`
- `yarn test:sim:backup_eth_provider`


## Custom Assertions

The following tests are found in `packages/beacon-node`

#### `test:sim:withdrawals`

This test simulates capella blocks with withdrawals. It tests lodestar against Geth and EthereumJS.

There are two ENV variables that are required to run this test:

- `EL_BINARY_DIR`: the docker image setup to handle the test case
- `EL_SCRIPT_DIR`: the script that will be used to start the EL client. All of the scripts can be found in `packages/beacon-node/test/scripts/el-interop` and the `EL_SCRIPT_DIR` is the sub-directory name in that root that should be used to run the test.

The command to run this test is:

`EL_BINARY_DIR=g11tech/geth:withdrawals EL_SCRIPT_DIR=gethdocker yarn mocha test/sim/withdrawal-interop.test.ts`

The images used by this test during CI are:

- `GETH_WITHDRAWALS_IMAGE: g11tech/geth:withdrawalsfeb8`
- `ETHEREUMJS_WITHDRAWALS_IMAGE: g11tech/ethereumjs:blobs-b6b63`

#### `test:sim:merge-interop`

#### `test:sim:mergemock`

#### `yarn test:sim:blobs`

## Docker Images Used in Sim Testing

- `GETH_IMAGE: ethereum/client-go:v1.10.25`
- `NETHERMIND_IMAGE: nethermind/nethermind:1.14.3`
- `MERGEMOCK_IMAGE: g11tech/mergemock:latest`
- `ETHEREUMJS_BLOBS_IMAGE: g11tech/ethereumjs:blobs-b6b63`
