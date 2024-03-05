# Simulation Tests

"Sim" testing for Lodestar is the most comprehensive, and complex, testing that is run. The goal is to fully simulate a testnet and to actuate the code in a way that closely mimics what will happen when turning on Lodestar in the wild. This is a very complex task and requires a lot of moving parts to work together. The following sections will describe the various components and how they work together.

At a very high level, simulation testing will setup a testnet from genesis and let proceed through "normal" execution exactly as the nodes would under production circumstances. To get feedback there are regular checks along the way to asses how the testnet nodes are working. These "assertions" can be added and removed at will to allow developers to check for specific conditions in a tightly controlled, reproducible, environment to get high quality and actionable feedback on how Lodestar performs. The end goal of these tests is to to run a full Lodestar client in an environment that is as close to what an end user would experience.

These tests usually setup full testnets with multiple consensus clients and their paired execution node. In many instance we are looking to just exercise the Lodestar code but there are some places where there is also testing to see how Lodestar works in relation to the other consensus clients, like Lighthouse. As you can imagine, there is quite a bit of machinery that is responsible for setting up and managing the simulations and assertions. This section will help to go over those bits and pieces. Many, but not all, of these classes can be found in `packages/cli/test/utils/simulation`.

## Running Sim Tests

There are a number of sim tests that are available and each has a slightly different purpose. All are run by CI and must pass for a PR to be valid for merging. Most tests require a couple of environment variables to be set.

### Environment Variables

To see what typical values for these are check out the `.env.test` file in the root directory.

- `GETH_DOCKER_IMAGE`: The geth docker image that will be used
- `NETHERMIND_IMAGE`: The nethermind docker image that will be used
- `LIGHTHOUSE_IMAGE`: The lighthouse docker image that will be used

### `test:sim:multifork`

The multi-fork sim test checks most of the functionality Lodestar provides. Is verifies that Lodestar is capable of peering, moving through all of the forks and using various sync methods in a testnet environment. Lodestar is tested with both Geth and Nethermind as the execution client. It also checks a Lighthouse/Geth node for cross client compatibility.

```sh
yarn workspace @chainsafe/lodestar test:sim:multifork
```

### `test:sim:endpoints`

This tests that various endpoints of the beacon node and validator client are working as expected.

```sh
yarn workspace @chainsafe/lodestar test:sim:endpoints
```

### `test:sim:deneb`

This test is still included in our CI but is no longer as important as it once was. Lodestar is often the first client to implement new features and this test was created before geth was upgraded with the features required to support the Deneb fork. To test that Lodestar was ready this test uses mocked geth instances. It is left as a placeholder for when the next fork comes along that requires a similar approach.

### `test:sim:mixedcleint`

Checks that Lodestar is compatible with other consensus validators and vice-versa. All tests use Geth as the EL.

```sh
yarn workspace @chainsafe/lodestar test:sim:mixedclient
```

## Sim Test Infrastructure

When setting up and running the simulations, interactions with the nodes is through the published node API's. All functionality is actuated via http request and by "plugging in" this way it is possible to run the nodes in a stand-alone fashion, as they would be run in production, but to still achieve a tightly monitored and controlled environment. If code needs to be executed on a "class by class" basis or with mocking involved then the test is not a simulation test and would fall into one of the other testing categories. See the [Testing Overview](./index.md) page for more information on the other types of tests available for Lodestar.

### Simulation Environment

The simulation environment has many pieces and those are orchestrated by the `SimulationEnvironment` class. The testnet nodes will be run as a mixture of Docker containers and bare metal code execution via Node.js. In order to monitor the various clients there is a `SimulationTracker` that's primary function is to `register` assertions that will track and gauge how the nodes are doing during the simulation. See the section on [Simulation Assertions](#simulation-assertions) below for more information on them. There is an `EpochClock` that has helper functions related to timing of slots and epochs and there is also a `Runner` that will help to start/stop the various Docker container and spawn the Node.js child processes as necessary.

The `SimulationEnvironment` is the orchestrator for all the various functions to great the test net and start it from genesis. It is also how the various forks are configured to exercise code through various fork transitions.

### Simulation Assertions

These are the secret sauce for making the simulation tests meaningful. There are several predefined assertions that can be added to a simulation tracker and one can also create custom assertions and add them to the environment. Assertions can be added per slot, per epoch, per fork or per node. They can even be added to check conditions across nodes.

Assertions are added to the `SimulationTracker` with the `register` method and the tracker follows the environment to make sure that assertions are run at the appropriate times, and on the correct targets.

Assertions are implemented via API calls to the various targets and meta from the API calls is stored and used to assert that the desired conditions were met. Any information that can be retrieved via API call can be added to the assertion `stores` for validation, and validations can be asserted at a specific time or on an interval.

There are a number of assertions that are added to simulations by default. They are:

- `inclusionDelayAssertion`
- `attestationsCountAssertion`
- `attestationParticipationAssertion`
- `connectedPeerCountAssertion`
- `finalizedAssertion`
- `headAssertion`
- `missedBlocksAssertion`
- `syncCommitteeParticipationAssertion`

Because of the flexibility, and complexity, there is a section specifically for how to create custom assertions below. See [custom assertions](#custom-assertions) for more info.

### Custom Assertions

Check back soon for more information on how to create custom assertions.

### Simulation Reports

Sim tests that are run using the simulation framework output a table of information to the console. The table summarizes the state of all of the nodes and the network at each slot.

Here is an example of the table and how to interpret it:

```sh
┼─────────────────────────────────────────────────────────────────────────────────────────────────┼
│ fork       │ eph   │ slot │ head       │ finzed   │ peers    │ attCount │ incDelay │ errors     │
┼─────────────────────────────────────────────────────────────────────────────────────────────────┼
│ capella    │ 9/0   │ 72   │ 0x95c4..   │ 56       │ 3        │ 16       │ 1.00     │ 0          │
│ capella    │ 9/1   │ 73   │ 0x9dfc..   │ 56       │ 3        │ 16       │ 1.00     │ 0          │
│ capella    │ 9/2   │ 74   │ 0xdf3f..   │ 56       │ 3        │ 16       │ 1.00     │ 0          │
│ capella    │ 9/3   │ 75   │ 0xbeae..   │ 56       │ 3        │ 16       │ 1.00     │ 0          │
│ capella    │ 9/4   │ 76   │ 0x15fa..   │ 56       │ 3        │ 16       │ 1.00     │ 0          │
│ capella    │ 9/5   │ 77   │ 0xf8ff..   │ 56       │ 2,3,3,2  │ 16       │ 1.00     │ 0          │
│ capella    │ 9/6   │ 78   │ 0x8199..   │ 56       │ 2,3,3,2  │ 16       │ 1.20     │ 0          │
│ capella    │ 9/7   │ 79   │ different  │ 56       │ 2,3,3,2  │ 16       │ 1.50     │ 2          │
┼─────────────────────────────────────────────────────────────────────────────────────────────────┼
│ Att Participation: H: 0.75, S: 1.00, T: 0.75 - SC Participation: 1.00                           │
┼─────────────────────────────────────────────────────────────────────────────────────────────────┼
```

#### Slot Information

- `fork`: shows what fork is currently being tested
- `eph`: During simulation tests the Lodestar repo is setup to use 8 slot per epoch so what is shown is the epoch number and the slot number within that epoch as `epoch/slot`
- `slot`: The slot number that is currently being processed
- `head`: If all clients have the the same head the first couple of bytes of the hash are shown. If all clients do not have the same head `different` is reported.
- `finzed`: Shows the number of the last finalized slot
- `peers`: The number of peers that each node is connected to. If all have the same number then only a single value is shown. If they do not have the same number of peers count for each node is reported in a comma-separated list
- `attCount`: The number of attestations that the node has seen.
- `incDelay`: The average number of slots inclusion delay was experienced for the attestations. Often attestations for the current head arrive more than one slot behind and this value tracks that
- `errors`: The number of errors that were encountered during the slot

#### Epoch Information

- `H`: The percentage of nodes, at epoch transition, that voted for the head block
- `S`: The percentage of nodes, at epoch transition, that voted for the source block
- `T`: The percentage of nodes, at epoch transition, that voted for the target block
- `SC Participation`: The sync committee participation rate

### Simulation Logging

The simulation environment will capture all of the logs from all nodes that are running. The logs can be found in the `packages/cli/test-logs` directory. The logs are named with the following convention:

`<PURPOSE>-<TYPE>_<CLIENT>.log`

Some examples are:

- `node-1-beacon_lodestar.log`: The is the first node in the simulation. It is the consensus layer. It is running the lodestar validator client.
- `range-sync-execution_geth.log`: This is the node that was added to test pulling history in range sync mode. It was the execution layer and was running the geth execution client.
