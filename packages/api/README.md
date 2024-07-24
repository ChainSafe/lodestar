# Lodestar Eth Consensus API

[![Discord](https://img.shields.io/discord/593655374469660673.svg?label=Discord&logo=discord)](https://discord.gg/aMxzVcr)
[![ETH Beacon APIs Spec v2.5.0](https://img.shields.io/badge/ETH%20beacon--APIs-2.5.0-blue)](https://github.com/ethereum/beacon-APIs/releases/tag/v2.5.0)
![ES Version](https://img.shields.io/badge/ES-2021-yellow)
![Node Version](https://img.shields.io/badge/node-22.x-green)

> This package is part of [ChainSafe's Lodestar](https://lodestar.chainsafe.io) project

Typescript REST client for the [Ethereum Consensus API](https://github.com/ethereum/beacon-apis)

## Usage

The REST client extends the native [Fetch API](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API), it behaves very similar in terms of error and response handling. It returns the same [Response object](https://developer.mozilla.org/en-US/docs/Web/API/Response) with additional methods to simplify usage and it allows to override all [Request options](https://developer.mozilla.org/en-US/docs/Web/API/Request/Request#options) if needed.

```typescript
import {getClient} from "@lodestar/api";
import {config} from "@lodestar/config/default";

const api = getClient({baseUrl: "http://localhost:9596"}, {config});

const res = await api.beacon.getStateValidator({stateId: "head", validatorId: 0});

const validator = res.value();

console.log("The validator balance is: ", validator.balance);
```

## Prerequisites

- [NodeJS](https://nodejs.org/) (LTS)
- [Yarn](https://classic.yarnpkg.com/lang/en/)

## What you need

You will need to go over the [specification](https://github.com/ethereum/beacon-apis).

## Getting started

- Follow the [installation guide](https://chainsafe.github.io/lodestar/) to install Lodestar.
- Quickly try out the whole stack by [starting a local testnet](https://chainsafe.github.io/lodestar/contribution/advanced-topics/setting-up-a-testnet/).

## Contributors

Read our [contributors document](/CONTRIBUTING.md), [submit an issue](https://github.com/ChainSafe/lodestar/issues/new/choose) or talk to us on our [discord](https://discord.gg/yjyvFRP)!

## License

Apache-2.0 [ChainSafe Systems](https://chainsafe.io)
