# Lodestar Eth Consensus Req/Resp Protocol

[![Discord](https://img.shields.io/discord/593655374469660673.svg?label=Discord&logo=discord)](https://discord.gg/aMxzVcr)
[![ETH Beacon APIs Spec v2.1.0](https://img.shields.io/badge/ETH%20beacon--APIs-2.1.0-blue)](https://github.com/ethereum/beacon-APIs/releases/tag/v2.1.0)
![ES Version](https://img.shields.io/badge/ES-2020-yellow)
![Node Version](https://img.shields.io/badge/node-18.x-green)

> This package is part of [ChainSafe's Lodestar](https://lodestar.chainsafe.io) project

Typescript REST client for the [Ethereum Consensus API spec](https://github.com/ethereum/beacon-apis)

## Usage

```typescript
import {Libp2p} from "libp2p";
import {EncodedPayloadType, ReqResp} from "@lodestar/reqresp";
import {Ping} from "@lodestar/reqresp/protocols";
import {Logger} from "@lodestar/utils";

async function getReqResp(libp2p: Libp2p, logger: Logger): Promise<void> {
  const reqResp = new ReqResp({libp2p, logger, metricsRegister: null});

  // Register a PONG handler to respond with caller's Ping request
  reqResp.registerProtocol(
    Ping(async function* (req: bigint) {
      yield {type: EncodedPayloadType.ssz, data: req};
    })
  );
}
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
