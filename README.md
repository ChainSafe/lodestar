# Overview
The goal of this repository is to provide an alternative implementation of the beacon chain 
that was recently announced by the Ethereum Core dev team. As even the Ethereum Core dev team don't know how the finalized beacon chain
will be implemented, this is our contribution to the effort to transitioning Ethereum from a PoW blockchain to a PoS blockchain.

This is currently a work in progress.

## What you need
You will need to go over the [specification](https://notes.ethereum.org/SCIg8AH5SA-O4C1G1LYZHQ?view#). You will also need to have a [basic understanding of sharding](https://github.com/ethereum/wiki/wiki/Sharding-FAQs). Note that that the specification is an ongoing document and will get outdated. The reference implementation by the Ethereum development team is written in Python and can be found [here](https://github.com/ethereum/beacon_chain).

## TODO
1. Complete implementation of bls.js
2. Complete implementation of block.js
3. Complete implementation of stateTransition.js

## Goals
1. Have well-documented tests
2. Have a UI demonstrating how a beacon chain can work.
3. Optimized code 
