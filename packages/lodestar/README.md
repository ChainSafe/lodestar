# Lodestar

[![](https://img.shields.io/travis/com/ChainSafe/lodestar/master.svg?label=master&logo=travis "Master Branch (Travis)")](https://travis-ci.com/ChainSafe/lodestar)
[![Discord](https://img.shields.io/discord/593655374469660673.svg?label=Discord&logo=discord)](https://discord.gg/aMxzVcr)
![ETH2.0_Spec_Version 0.12.1](https://img.shields.io/badge/ETH2.0_Spec_Version-0.12.1-2e86c1.svg)
![ES Version](https://img.shields.io/badge/ES-2020-yellow)
![Node Version](https://img.shields.io/badge/node-12.x-green)

> This package is part of [ChainSafe's Lodestar](https://lodestar.chainsafe.io) project

## Prerequisites

- [Yarn](https://yarnpkg.com/)

## What you need

You will need to go over the [specification](https://github.com/ethereum/eth2.0-specs). You will also need to have a [basic understanding of sharding](https://github.com/ethereum/wiki/wiki/Sharding-FAQs).

## Getting started

- Follow the [installation guide](https://chainsafe.github.io/lodestar/installation) to install Lodestar.
- Quickly try out the whole stack by [starting a local testnet](https://chainsafe.github.io/lodestar/usage).
- View the [typedoc code docs](https://chainsafe.github.io/lodestar/packages).

## Architecture Overview

Here is an overview of the sub-components of this package and their uses:

### api
  - various REST API calls that can be made for:
    - beacon
      - get data about the beacon state and publish new data
    - events
      - sets up an event stream to listen for new beacon node events
    - node
      - get data about the node process that is running Lodestar
    - validator
      - perform (and get relevant data for) validator duties
### chain
  - processing block and attestation data to/from the beacon chain
### db
  - handles all persistent data stored to the local leveldb while running the beacon chain.  uses [@chainsafe/lodestar-db](https://github.com/ChainSafe/lodestar/tree/master/packages/lodestar-db) under the hood.
### eth1
  - handles all interactions with the eth1 blockchain (e.g. deposit data)
### metrics
  - exposes Lodestar metrics data that can be read using clients such as [Prometheus & Grafana](https://chainsafe.github.io/lodestar/usage/prometheus-grafana/)
### network
  - eth2 network implementation as defined by the [Eth2 Networking Spec](https://github.com/ethereum/eth2.0-specs/blob/dev/specs/phase0/p2p-interface.md)
### node
  - contains the nodeJS process that bootstraps and runs Lodestar
  - contains the entrypoint that [@chainsafe/lodestar-cli](https://github.com/ChainSafe/lodestar/tree/master/packages/lodestar-cli/) calls to start the beacon node
### sync
  - "syncing" is the process by which the beacon node stays updated with new data published on eth2.  there are two such processes in Lodestar:
    - initial sync
      - sync new data until we reach the head of the chain
    - regular sync
      - once we have finished initial sync (i.e. reached the head of the chain), regular sync keeps us updated in realtime as the chain head moves forward
### tasks
### util
  - various utility functions used by all of the above

## Contributors

Read our [contributors document](/CONTRIBUTING.md), [submit an issue](https://github.com/ChainSafe/lodestar/issues/new/choose) or talk to us on our [discord](https://discord.gg/yjyvFRP)!

## License

LGPL-3.0 [ChainSafe Systems](https://chainsafe.io)
