### ChainSafe ETH2.0 Projects
Note:
There is a lot of work being done that are core infrastructural pieces for Eth2.0. Contributions to any of the below repositories would be greatly appreciated. All the libraries are written in TypeScript (or in the process of being converted from pure JS to TypeScript):
<br />
-- [PM / Meta Repo](https://github.com/ChainSafe/Sharding)<br />
|-- [Beacon Chain](https://github.com/ChainSafe/lodestar)<br />
|-- [Validator Client](https://github.com/ChainSafe/Validator-Client)<br />
|-- [Simple Serialize (SSZ)](https://github.com/ChainSafe/ssz-js)<br />
|-- [BLS Singatures and Signature Aggregation](https://github.com/ChainSafe/bls-js)<br />
|-- [Hobbits](https://github.com/ChainSafe/hobbits-ts)<br />
|-- [Gossipsub](https://github.com/ChainSafe/gossipsub-js)<br />

[![](https://img.shields.io/travis/com/ChainSafe/lodestar/master.svg?label=master&logo=travis "Master Branch (Travis)")](https://travis-ci.com/ChainSafe/lodestar)
[![](https://badges.gitter.im/chainsafe/lodestar.svg)](https://gitter.im/chainsafe/lodestar?utm_source=badge&utm_medium=badge&utm_campaign=pr-badge&utm_content=badge)
![](https://img.shields.io/codecov/c/github/ChainSafe/lodestar.svg?label=Codecov&style=flat)
[![Maintainability](https://api.codeclimate.com/v1/badges/678099476c401e1af503/maintainability)](https://codeclimate.com/github/ChainSafe/lodestar/maintainability)

# Overview
The goal of this repository is to provide an implementation of the beacon chain. As even the Ethereum Core dev team don't know how the finalized beacon chain
will be implemented, this is our contribution to the effort to transitioning Ethereum from a PoW blockchain to a PoS blockchain.


We are currently targeting version 0.3.0: Let There Be Liquidity release of the specification. As such, this is currently a work in progress and you can ask questions and contribute in our [gitter](https://gitter.im/chainsafe/lodestar-chain).

## What you need
You will need to go over the [specification](https://github.com/ethereum/eth2.0-specs). You will also need to have a [basic understanding of sharding](https://github.com/ethereum/wiki/wiki/Sharding-FAQs). Note that that the specification is an ongoing document and will get outdated. The reference implementation by the Ethereum development team is written in Python and can be found [here](https://github.com/ethereum/beacon_chain).

## Run
1. `npm install`
2. `npm test`

## Contributors
If you would like to contribute, please submit an issue or talk to us on our [gitter](https://gitter.im/chainsafe/lodestar-chain).

## Donations
We are a local group of Toronto open source developers. As such, all of our open source work is funded by grants. We all take the time out of our hectic lives to contribute to the Ethereum ecosystem.
If you want to donate, you can send us ETH at the following address: 0xBceDE714283f348EBB3e5cBaF8A947Cab3C8bE8d
