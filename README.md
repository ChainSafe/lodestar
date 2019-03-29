### ChainSafe ETH2.0 Projects
Note:
There is a lot of work being done that are core infrastructural pieces for Eth2.0. Contributions to any of the below repositories would be greatly appreciated. All the libraries are written in TypeScript (or in the process of being converted from pure JS to TypeScript):
<br />
-- [PM / Meta Repo](https://github.com/ChainSafe/Sharding)<br />
|-- [Beacon Chain](https://github.com/ChainSafe/lodestar_chain)<br />
|-- [Simple Serialize (SSZ)](https://github.com/ChainSafe/ssz-js)<br />
|-- [Fixed Size Numbers](https://github.com/ChainSafe/fixed-sized-numbers-ts/)<br />
|-- [BLS Singatures and Signature Aggregation](https://github.com/ChainSafe/bls-js)<br />

# bls-js

This is a Javascript library that implements BLS (Boneh-Lynn-Shacham) signatures and supports signature aggregation.

>[spec](https://github.com/ethereum/eth2.0-specs/blob/master/specs/bls_signature.md)

>[test vectors](https://github.com/ethereum/eth2.0-tests/blob/bls-vectors/test_vectors/test_bls.yml)

## Install
`npm install -g bls-js`

## To run test
`npm test`

