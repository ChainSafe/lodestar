### ChainSafe ETH2.0 Projects
Note:
There is a lot of work being done that are core infrastructural pieces for Eth2.0. Contributions to any of the below repositories would be greatly appreciated. All the libraries are written in TypeScript (or in the process of being converted from pure JS to TypeScript):
<br />
-- [PM / Meta Repo](https://github.com/ChainSafe/Sharding)<br />
|-- [Beacon Chain](https://github.com/ChainSafe/lodestar)<br />
|-- [Validator Client](https://github.com/ChainSafe/lodestar/tree/master/src/validator)<br />
|-- [Simple Serialize (SSZ)](https://github.com/ChainSafe/ssz-js)<br />
|-- [BLS Signatures and Signature Aggregation](https://github.com/ChainSafe/bls-js)<br />
|-- [Hobbits](https://github.com/ChainSafe/hobbits-ts)<br />
|-- [Gossipsub](https://github.com/ChainSafe/gossipsub-js)<br />

[![](https://img.shields.io/travis/com/ChainSafe/lodestar/master.svg?label=master&logo=travis "Master Branch (Travis)")](https://travis-ci.com/ChainSafe/lodestar)
![Discord](https://img.shields.io/discord/593655374469660673.svg?label=Discord&logo=discord)
[![codecov](https://codecov.io/gh/ChainSafe/lodestar/branch/master/graph/badge.svg)](https://codecov.io/gh/ChainSafe/lodestar)
[![Maintainability](https://api.codeclimate.com/v1/badges/678099476c401e1af503/maintainability)](https://codeclimate.com/github/ChainSafe/lodestar/maintainability)
![ETH2.0_Spec_Version 0.7.1](https://img.shields.io/badge/ETH2.0_Spec_Version-0.7.1-2e86c1.svg)

# Overview
The goal of this repository is to provide an implementation of the beacon chain. As even the Ethereum Core dev team don't know how the finalized beacon chain
will be implemented, this is our contribution to the effort to transitioning Ethereum from a PoW blockchain to a PoS blockchain.

## What you need
You will need to go over the [specification](https://github.com/ethereum/eth2.0-specs). You will also need to have a [basic understanding of sharding](https://github.com/ethereum/wiki/wiki/Sharding-FAQs). Note that that the specification is an ongoing document and will get outdated. The reference implementation by the Ethereum development team is written in Python and can be found [here](https://github.com/ethereum/beacon_chain).

## Run
1. `yarn install`
2. `git submodule foreach git lfs pull`
2. `yarn test`

Note: to run spec tests execute `git submodules foreach git lfs pull`

#### Generating flame graphs from spec tests
Example of cpu-profile generation of blocksanity tests in current directory

`GEN_PROFILE_DIR=$PWD mocha -r ./.babel-register 'test/spec/sanity/blocks/blocksanity_s_mainnet.test.ts'`

To view results:
```bash
npm i -g ox
0x --visualize-cpu-profile ./0\ -\ blocksanity-1561705313935.cpuprofile
```
Open resulting html file in favorite browser.

## Usage
1. If you haven't `yarn install`
2. `yarn build`
3. `./bin/lodestar --help`

### Starting private eth1 chain

`./bin/lodestar eth1:dev -m "vast thought differ pull jewel broom cook wrist tribe word before omit"`

This will start ganache server on `http://127.0.0.1:8545`. For more configuration check `./bin/lodestar eth1:dev --help`

### Starting lodestar beacon chain

`./bin/lodestar beacon --db test-db --eth1RpcUrl http://127.0.0.1:8545 --depositContract <depositContractAddress>`

You will see deposit contract address in console if you used `./bin/lodestar eth1:dev`.

### Making validator deposit

`./bin/lodestar deposit -m "vast thought differ pull jewel broom cook wrist tribe word before omit" -n http://127.0.0.1:8545 -c <depositContractAddress>>`

This will trigger 10 deposits to deposit contract which will trigger beacon chain initialization. Make sure to use same mnemonic which you used to start eth1 network.

## Contributors
If you would like to contribute, please submit an issue or talk to us on our [discord](https://discord.gg/yjyvFRP).

## Donations
We are a local group of Toronto open source developers. As such, all of our open source work is funded by grants. We all take the time out of our hectic lives to contribute to the Ethereum ecosystem.
If you want to donate, you can send us ETH at the following address: 0xBceDE714283f348EBB3e5cBaF8A947Cab3C8bE8d
