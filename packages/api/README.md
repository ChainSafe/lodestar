# Lodestar Eth Consensus API

[![Discord](https://img.shields.io/discord/593655374469660673.svg?label=Discord&logo=discord)](https://discord.gg/aMxzVcr)
[![ETH Beacon APIs Spec v2.1.0](https://img.shields.io/badge/ETH%20beacon--APIs-2.1.0-blue)](https://github.com/ethereum/beacon-APIs/releases/tag/v2.1.0)
![ES Version](https://img.shields.io/badge/ES-2020-yellow)
![Node Version](https://img.shields.io/badge/node-18.x-green)

> This package is part of [ChainSafe's Lodestar](https://lodestar.chainsafe.io) project

Typescript REST client for the [Ethereum Consensus API spec](https://github.com/ethereum/beacon-apis)

## Usage

We use more typesafe approach for the API client, where all the errors are returned not thrown. This approach is more easy to document and better to handle all possible error cases.

```typescript
import {getClient, HttpError} from "@lodestar/api";
import {config} from "@lodestar/config/default";

const api = getClient({baseUrl: "http://localhost:9596"}, {config});

api.beacon
  .getStateValidator(
    "head",
    "0x933ad9491b62059dd065b560d256d8957a8c402cc6e8d8ee7290ae11e8f7329267a8811c397529dac52ae1342ba58c95"
  )
  .then((res) => {
    if(res.ok) {
      console.log("Your balance is:", res.response.data.balance, res.ok, res.status);
    } else {
      console.error(res.status, res.error.code, res.error.message);
    }
  });
```

## Prerequisites

- [Lerna](https://github.com/lerna/lerna)
- [Yarn](https://yarnpkg.com/)

## What you need

You will need to go over the [specification](https://github.com/ethereum/beacon-apis). You will also need to have a [basic understanding of sharding](https://eth.wiki/sharding/Sharding-FAQs).

## Getting started

- Follow the [installation guide](https://chainsafe.github.io/lodestar/) to install Lodestar.
- Quickly try out the whole stack by [starting a local testnet](https://chainsafe.github.io/lodestar/usage/local).

## Contributors

Read our [contributors document](/CONTRIBUTING.md), [submit an issue](https://github.com/ChainSafe/lodestar/issues/new/choose) or talk to us on our [discord](https://discord.gg/yjyvFRP)!

## License

Apache-2.0 [ChainSafe Systems](https://chainsafe.io)
