# Beacon Node Module Architecture

## Lodestar Beacon Node Modules

When `lodestar beacon --network NETWORK_NAME` (as described in [CLI Reference](../reference/cli)) is ran, [@chainsafe/lodestar-cli](https://github.com/ChainSafe/lodestar/tree/master/packages/cli) does the following:

- gathers data required to run the beacon node based on local configurations and CLI options
- bootstraps the [`BeaconNode`](https://github.com/ChainSafe/lodestar/blob/54e13c9908054b99f68e420ee7c0273fba9db3f9/packages/lodestar/src/node/nodejs.ts#L66) (in the `node` module) in [@chainsafe/lodestar](https://github.com/ChainSafe/lodestar/tree/master/packages/lodestar)

The `node` then bootstraps the other modules. Within [@chainsafe/lodestar](https://github.com/ChainSafe/lodestar), there are several modules that are started by the `node` process that bootstraps the beacon node:

### [api](https://github.com/ChainSafe/lodestar/tree/master/packages/lodestar/src/api)

- various REST API calls that can be made for:
  - beacon
    - get data about the beacon state and publish new data
  - events
    - sets up an event stream to listen for new beacon node events
  - node
    - get data about the node process that is running Lodestar
  - validator
    - perform (and get relevant data for) validator duties
- based on [https://github.com/ethereum/eth2.0-apis](https://github.com/ethereum/eth2.0-apis)

### [chain](https://github.com/ChainSafe/lodestar/tree/master/packages/lodestar/src/chain)

- processing block and attestation data to/from the beacon chain

### [db](https://github.com/ChainSafe/lodestar/tree/master/packages/lodestar/src/db)

- handles all persistent data stored to the local leveldb while running the beacon chain. uses [@chainsafe/lodestar-db](https://github.com/ChainSafe/lodestar/tree/master/packages/db) under the hood.

### [eth1](https://github.com/ChainSafe/lodestar/tree/master/packages/lodestar/src/eth1)

- handles all interactions with the eth1 blockchain (e.g. deposit data)

### [metrics](https://github.com/ChainSafe/lodestar/tree/master/packages/lodestar/src/metrics)

- exposes Lodestar metrics data that can be read using clients such as [Prometheus & Grafana](https://chainsafe.github.io/lodestar/usage/prometheus-grafana/)

### [network](https://github.com/ChainSafe/lodestar/tree/master/packages/lodestar/src/ntwork)

- eth2 network implementation as defined by the [Eth2 Networking Spec](https://github.com/ethereum/eth2.0-specs/blob/dev/specs/phase0/p2p-interface.md)

### [node](https://github.com/ChainSafe/lodestar/tree/master/packages/lodestar/src/node)

- contains the nodeJS process that bootstraps and runs Lodestar
- contains the entrypoint that [@chainsafe/lodestar-cli](https://github.com/ChainSafe/lodestar/tree/master/packages/cli/) calls to start the beacon node

### [sync](https://github.com/ChainSafe/lodestar/tree/master/packages/lodestar/src/sync)

- "syncing" is the process by which the beacon node stays updated with new data published on eth2. there are two such processes in Lodestar:
  - initial sync
    - sync new data until we reach the head of the chain
  - regular sync
    - once we have finished initial sync (i.e. reached the head of the chain), regular sync keeps us updated in realtime as the chain head moves forward

### [tasks](https://github.com/ChainSafe/lodestar/tree/master/packages/lodestar/src/tasks)

### [util](https://github.com/ChainSafe/lodestar/tree/master/packages/lodestar/src/util)

- various utility functions used by all of the above

## Beacon Node Data Flow

### Entry Paths for Data

There are a few paths that data can be brought into the beacon chain via outside sources:

- via `api`
  - a validator can be proposing a new block
- via `network`
  - req/resp - we can be explicitly requesting a block
  - gossip - we receive a block propagating across the network

### Data Flow Diagram

Here's a diagram of how data flows across the modules of the beacon node. Click on a module or package in the diagram to see where it exists in the lodestar repo.

```mermaid
graph TD
    lodestar-validator(lodestar-validator)
    click lodestar-validator "https://github.com/ChainSafe/lodestar/tree/master/packages/validator"
    lodestar-validator-->|proposes block|api

    api:::nodemodule
    chain:::nodemodule
    db:::nodemodule
    eth1:::nodemodule
    network:::nodemodule
    sync:::nodemodule

    api-->|block data|db
    api-->|block data|lodestar-validator
    api-->|proposed block|network
    api-->|proposed block|chain
    api-->|attestation subnet subscription|sync

    lodestar-fork-choice(lodestar-fork-choice)
    click lodestar-fork-choice "https://github.com/ChainSafe/lodestar/tree/master/packages/fork-choice"
    chain-->|get/set DAG|lodestar-fork-choice
    chain-->|block data|api

    eth1-->|eth1 deposit data|chain

    sync-->|block data|db
    sync-->|sync status & attestation subnet subscription|network
    sync-->|block data|chain
    sync-->|sync status|api

    chain-->|block data|db
    chain-->|checkpoint/block|sync

    peers([gossip peers])
    network-->|peer data|sync
    network-->|proposed block|peers
    peers-->|incoming block|network

    db-->lodestar-db[(lodestar-db)]
    click lodestar-db "https://github.com/ChainSafe/lodestar/tree/master/packages/db"

    click api "https://github.com/ChainSafe/lodestar/tree/master/packages/lodestar/src/api"
    click chain "https://github.com/ChainSafe/lodestar/tree/master/packages/lodestar/src/chain"
    click db "https://github.com/ChainSafe/lodestar/tree/master/packages/lodestar/src/db"
    click eth1 "https://github.com/ChainSafe/lodestar/tree/master/packages/lodestar/src/eth1"
    click network "https://github.com/ChainSafe/lodestar/tree/master/packages/lodestar/src/network"
    click sync "https://github.com/ChainSafe/lodestar/tree/master/packages/lodestar/src/sync"

    classDef nodemodule fill:grey,stroke-width:2px,stroke:black,color:white;
    linkStyle default stroke:grey, fill:none,stroke-width:1.5px;

    classDef lodestarpkg color:black, fill:#FFF566,stroke:black, stroke-width: 1.5px;
    class lodestar-fork-choice,lodestar-validator,lodestar-db lodestarpkg;
    style peers color: black, fill:#bbf, stroke-width:2px, color:#fff, stroke-dasharray: 5 5;

```
