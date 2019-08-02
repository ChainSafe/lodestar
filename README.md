### ChainSafe ETH2.0 Projects
Note:
There is a lot of work being done that are core infrastructural pieces for Eth2.0. Contributions to any of the below repositories would be greatly appreciated. All the libraries are written in TypeScript (or in the process of being converted from pure JS to TypeScript):
<br />
-- [PM / Meta Repo](https://github.com/ChainSafe/Sharding)<br />
|-- [Beacon Chain](https://github.com/ChainSafe/lodestar_chain)<br />
|-- [Simple Serialize (SSZ)](https://github.com/ChainSafe/ssz-js)<br />
|-- [Fixed Size Numbers](https://github.com/ChainSafe/fixed-sized-numbers-ts/)<br />
|-- [BLS Signatures and Signature Aggregation](https://github.com/ChainSafe/bls-js)<br />

# bls-js

[![Build Status](https://travis-ci.org/ChainSafe/bls-js.svg?branch=master)](https://travis-ci.org/ChainSafe/bls-js)
[![codecov](https://codecov.io/gh/ChainSafe/bls-js/branch/master/graph/badge.svg)](https://codecov.io/gh/ChainSafe/bls-js)
[![](https://badges.gitter.im/chainsafe/lodestar.svg)](https://gitter.im/chainsafe/lodestar?utm_source=badge&utm_medium=badge&utm_campaign=pr-badge&utm_content=badge)
![ETH2.0_Spec_Version 0.8.0](https://img.shields.io/badge/ETH2.0_Spec_Version-0.8.0-2e86c1.svg)

This is a Javascript library that implements BLS (Boneh-Lynn-Shacham) signatures and supports signature aggregation.

>[spec](https://github.com/ethereum/eth2.0-specs/blob/master/specs/bls_signature.md)

>[test vectors](https://github.com/ethereum/eth2.0-spec-tests/tree/master/tests/bls)

## Usage
- `yarn add @chainsafe/bls`

## Development
- `git clone --recursive git@github.com:ChainSafe/bls-js.git`
- `yarn install`
- `yarn test`

