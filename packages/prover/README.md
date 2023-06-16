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
  new Web3.providers.HttpProvider("https://lodestar-sepoliarpc.chainsafe.io"),
  {
    transport: LCTransport.Rest,
    urls: ["https://lodestar-sepolia.chainsafe.io"],
    network: "sepolia",
    wsCheckpoint: "trusted-checkpoint",
  }
);

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

## Supported Web3 Methods

✅ - Completed

⌛ - Todo

➡️ - Request will be forward to EL without any intermediary manipulations. You can limit these by providing `unverifiedWhitelist` option for provider or `--unverifiedWhitelist` from the cli. If not set then all methods will be forwarded.

❇️ - Always forwarded to EL.

| Group             | Method                                  | Status | Version |
| ----------------- | --------------------------------------- | ------ | ------- |
| Block             | eth_getBlockByHash                      | ✅     | v0      |
|                   | eth_getBlockByNumber                    | ✅     | v0      |
|                   | eth_getBlockTransactionCountByHash      | ⌛     | v2      |
|                   | eth_getBlockTransactionCountByNumber    | ⌛     | v2      |
|                   | eth_getUncleCountByBlockHash            | ⌛     | v2      |
|                   | eth_getUncleCountByBlockNumber          | ⌛     | v2      |
| Chain/Network     | eth_chainId                             | ➡️     |
|                   | eth_syncing                             | ⌛     | v1      |
|                   | eth_coinbase                            | ⌛     | v2      |
|                   | eth_accounts                            | ➡️     |
|                   | eth_blockNumber                         | ➡️     |
| Call and Estimate | eth_call                                | ✅     | v0      |
|                   | eth_estimateGas                         | ✅     | v0      |
|                   | eth_createAccessList                    | ⌛     | v2      |
|                   | eth_gasPrice                            | ⌛     | v1      |
|                   | eth_maxPriorityFeePerGas                | ⌛     | v1      |
|                   | eth_feeHistory                          | ⌛     | v2      |
| Filters           | eth_newFilter                           | ⌛     | v2      |
|                   | eth_newBlockFilter                      | ⌛     | v2      |
|                   | eth_newPendingTransactionFilter         | ⌛     | v2      |
|                   | eth_uninstallFilter                     | ⌛     | v2      |
|                   | eth_getFilterChanges                    | ⌛     | v2      |
|                   | eth_getFilterLogs                       | ⌛     | v2      |
|                   | eth_getLogs                             | ⌛     | v1      |
| Mining            | eth_mining                              | ➡️     |
|                   | eth_hashrate                            | ➡️     |
|                   | eth_getWork                             | ➡️     |
|                   | eth_submitWork                          | ➡️     |
|                   | eth_submitHashrate                      | ➡️     |
| Signing           | eth_sign                                | ➡️     |
|                   | eth_signTransaction                     | ➡️     |
| State             | eth_getBalance                          | ✅     | v0      |
|                   | eth_getStorageAt                        | ⌛     | v1      |
|                   | eth_getTransactionCount                 | ⌛     | v2      |
|                   | eth_getCode                             | ✅     | v0      |
|                   | eth_getProof                            | ❇️     | v0      |
| Transactions      | eth_sendTransaction                     | ➡️     |
|                   | eth_sendRawTransaction                  | ➡️     |
|                   | eth_getTransactionByHash                | ⌛     | v2      |
|                   | eth_getTransactionByBlockHashAndIndex   | ⌛     | v2      |
|                   | eth_getTransactionByBlockNumberAndIndex | ⌛     | v2      |
|                   | eth_getTransactionReceipt               | ⌛     | v2      |
| Events            | eth_subscribe                           | ❇️     | v0      |
|                   | eth_unsubscribe                         | ❇️     | v0      |

## Non-supported features

- Currently does not support batch requests.

## Warnings

- To use this prover the ehtereum provider must support the `eth_getProof` method. Unfortunately, Infura does not currently support this endpoint. As an alternative, we suggest using Alchemy.

## Prerequisites

- [NodeJS](https://nodejs.org/) (LTS)
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
