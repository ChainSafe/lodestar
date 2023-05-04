# Lodestar Eth Consensus Lightclient Prover

[![Discord](https://img.shields.io/discord/593655374469660673.svg?label=Discord&logo=discord)](https://discord.gg/aMxzVcr)
[![ETH Beacon APIs Spec v2.1.0](https://img.shields.io/badge/ETH%20beacon--APIs-2.1.0-blue)](https://github.com/ethereum/beacon-APIs/releases/tag/v2.1.0)
![ES Version](https://img.shields.io/badge/ES-2020-yellow)
![Node Version](https://img.shields.io/badge/node-18.x-green)

> This package is part of [ChainSafe's Lodestar](https://lodestar.chainsafe.io) project

Typescript REST client for the [Ethereum Consensus API spec](https://github.com/ethereum/beacon-apis)

## Usage

You can use the `@lodestar/prover` in two ways, as a Web3 Provider and as proxy. For prover use case see below example.

```ts
import Web3 from "web3";
import {createVerifiedExecutionProvider, LCTransport} from "@lodestar/prover";

const {provider, proofProvider} = createVerifiedExecutionProvider(
  new Web3.providers.HttpProvider("https://lodestar-sepoliarpc.chainsafe.io"), {
  transport: LCTransport.Rest,
  urls: ["https://lodestar-sepolia.chainsafe.io"],
  network: "sepolia",
  wsCheckpoint: "trusted-checkpoint"
});

const web3 = new Web3(provider);

const address = "0xf97e180c050e5Ab072211Ad2C213Eb5AEE4DF134";
const balance = await web3.eth.getBalance(address, "latest");
console.log({balance, address});
```

You can also invoke the package as binary.

```bash
npm -i g @lodestar/prover 

lodestar-prover start \
  --network sepolia \
  --execution-rpc https://lodestar-sepoliarpc.chainsafe.io \
  --mode rest \
  --beacon-rpc https://lodestar-sepolia.chainsafe.io \
  --port 8080
```

## Prerequisites

- [Lerna](https://github.com/lerna/lerna)
- [Yarn](https://yarnpkg.com/)

## What you need

You will need to go over the [specification](https://github.com/ethereum/beacon-apis). You will also need to have a [basic understanding of lightclient](https://github.com/ethereum/consensus-specs/blob/dev/specs/altair/light-client/light-client.md).

## Getting started

- Follow the [installation guide](https://chainsafe.github.io/lodestar/) to install Lodestar.
- Quickly try out the whole stack by [starting a local testnet](https://chainsafe.github.io/lodestar/usage/local).

## Contributors

Read our [contributors document](/CONTRIBUTING.md), [submit an issue](https://github.com/ChainSafe/lodestar/issues/new/choose) or talk to us on our [discord](https://discord.gg/yjyvFRP)!

## License

Apache-2.0 [ChainSafe Systems](https://chainsafe.io)
