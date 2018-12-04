[![Build Status](https://travis-ci.com/ChainSafeSystems/lodestar_chain.svg?branch=master)](https://travis-ci.com/ChainSafeSystems/lodestar_chain)

# Overview
The goal of this repository is to provide an implementation of the beacon chain. As even the Ethereum Core dev team don't know how the finalized beacon chain
will be implemented, this is our contribution to the effort to transitioning Ethereum from a PoW blockchain to a PoS blockchain.

This is currently a work in progress and you can ask questions and contribute in our [gitter](https://gitter.im/chainsafe/lodestar-chain).

Our current file structure is:
```
loadestar_chain/
-- beaconChain/  # Non-solidity components
-- solidity/     # Contracts, truffle project
```

## What you need
You will need to go over the [specification](https://github.com/ethereum/eth2.0-specs). You will also need to have a [basic understanding of sharding](https://github.com/ethereum/wiki/wiki/Sharding-FAQs). Note that that the specification is an ongoing document and will get outdated. The reference implementation by the Ethereum development team is written in Python and can be found [here](https://github.com/ethereum/beacon_chain).

## Run
1. `cd beaconChain`
2. `npm install`
3. `npm test`

## Note about tests
For `solidity/` you will need to ensure that there is a terminal window with ganache-cli running to execute the tests. Ensure the dependencies are installed then run `truffle test`.

For `beaconChain/` you can run `npm test` after installing dependencies.

## Contributors
If you would like to contribute, please submit an issue or talk to us on our [gitter](https://gitter.im/chainsafe/lodestar-chain).
