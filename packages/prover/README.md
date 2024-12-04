# Lodestar Prover

[![Discord](https://img.shields.io/discord/593655374469660673.svg?label=Discord&logo=discord)](https://discord.gg/aMxzVcr)
[![ETH Beacon APIs Spec v2.5.0](https://img.shields.io/badge/ETH%20beacon--APIs-2.5.0-blue)](https://github.com/ethereum/beacon-APIs/releases/tag/v2.5.0)
![ES Version](https://img.shields.io/badge/ES-2021-yellow)
![Node Version](https://img.shields.io/badge/node-22.x-green)

> This package is part of [ChainSafe's Lodestar](https://lodestar.chainsafe.io) project

A set of tools allowing to verify EL client JSON-RPC calls.

## Usage

You can use the `@lodestar/prover` in two ways, as a Web3 Provider and as proxy. For prover use case see below example.

```ts
import Web3 from "web3";
import {createVerifiedExecutionProvider, LCTransport} from "@lodestar/prover";

const httpProvider = new Web3.providers.HttpProvider("https://lodestar-sepoliarpc.chainsafe.io");

const {provider, proofProvider} = createVerifiedExecutionProvider(httpProvider, {
  transport: LCTransport.Rest,
  urls: ["https://lodestar-sepolia.chainsafe.io"],
  network: "sepolia",
  wsCheckpoint: "trusted-checkpoint",
});

const web3 = new Web3(provider);

const address = "0xf97e180c050e5Ab072211Ad2C213Eb5AEE4DF134";
const balance = await web3.eth.getBalance(address, "latest");
console.log({balance, address});
```

In this scenario the actual provider is mutated to handle the RPC requests and verify those. So here if you use `provider` or `httpProvider` both are the same objects. This behavior is useful when you already have an application and usage of any provider across the code space and don't want to change the code. So you mutate the provider during startup.

For some scenarios when you don't want to mutate the provider you can pass an option `mutateProvider` as `false`. In this scenario the object `httpProvider` is not mutated and you get a new object `provider`. This is useful when your provider object does not allow mutation, e.g. Metamask provider accessible through `window.ethereum`. If not provided `mutateProvider` is considered as `true` by default. In coming releases we will switch its default behavior to `false`.

```ts
import Web3 from "web3";
import {createVerifiedExecutionProvider, LCTransport} from "@lodestar/prover";

const httpProvider = new Web3.providers.HttpProvider("https://lodestar-sepoliarpc.chainsafe.io");

const {provider, proofProvider} = createVerifiedExecutionProvider(httpProvider, {
  transport: LCTransport.Rest,
  urls: ["https://lodestar-sepolia.chainsafe.io"],
  network: "sepolia",
  wsCheckpoint: "trusted-checkpoint",
  mutateProvider: false,
});

const web3 = new Web3(provider);

const address = "0xf97e180c050e5Ab072211Ad2C213Eb5AEE4DF134";
const balance = await web3.eth.getBalance(address, "latest");
console.log({balance, address});
```

You can also invoke the package as binary.

```bash
npm i -g @lodestar/prover

lodestar-prover proxy \
  --network sepolia \
  --executionRpcUrl https://lodestar-sepoliarpc.chainsafe.io \
  --beaconUrls https://lodestar-sepolia.chainsafe.io \
  --port 8080
```

## How to detect a web3 provider

There can be different implementations of the web3 providers and each can handle the RPC request differently. We call those different provider types. We had provided builtin support for common providers e.g. web3.js, ethers or any eip1193 compatible providers. We inspect given provider instance at runtime to detect the correct provider type.

If your project is using some provider type which is not among above list, you have the option to register a custom provider type with the `createVerifiedExecutionProvider` with the option `providerTypes` which will be an array of your supported provider types. Your custom provider types will have higher priority than default provider types. Please see [existing provide types implementations](https://github.com/ChainSafe/lodestar/tree/unstable/packages/prover/src/provider_types) to know how to implement your own if needed.

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

- To use this prover the ethereum provider must support the `eth_getProof` method. Unfortunately, Infura does not currently support this endpoint. As an alternative, we suggest using Alchemy.

## Prerequisites

- [NodeJS](https://nodejs.org/) (LTS)
- [Yarn](https://classic.yarnpkg.com/lang/en/)

## What you need

You will need to go over the [specification](https://github.com/ethereum/beacon-apis). You will also need to have a [basic understanding of lightclient](https://github.com/ethereum/consensus-specs/blob/dev/specs/altair/light-client/light-client.md).

## Getting started

- Follow the [installation guide](https://chainsafe.github.io/lodestar/run/getting-started/installation) to install Lodestar.
- Quickly try out the whole stack by [starting a local testnet](https://chainsafe.github.io/lodestar/advanced-topics/setting-up-a-testnet).

## Contributors

Read our [contributors document](https://chainsafe.github.io/lodestar/contribution/getting-started), [submit an issue](https://github.com/ChainSafe/lodestar/issues/new/choose) or talk to us on our [discord](https://discord.gg/yjyvFRP)!

## License

Apache-2.0 [ChainSafe Systems](https://chainsafe.io)
