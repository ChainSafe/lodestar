# Lodestar Eth Consensus Req/Resp Protocol

[![Discord](https://img.shields.io/discord/593655374469660673.svg?label=Discord&logo=discord)](https://discord.gg/aMxzVcr)
[![ETH Beacon APIs Spec v2.1.0](https://img.shields.io/badge/ETH%20beacon--APIs-2.1.0-blue)](https://github.com/ethereum/beacon-APIs/releases/tag/v2.1.0)
![ES Version](https://img.shields.io/badge/ES-2021-yellow)
![Node Version](https://img.shields.io/badge/node-20.x-green)

> This package is part of [ChainSafe's Lodestar](https://lodestar.chainsafe.io) project

Typescript REST client for the [Ethereum Consensus API spec](https://github.com/ethereum/beacon-apis)

## Usage

```typescript
import {Libp2p} from "libp2p";
import {ssz} from "@lodestar/types";
import {ReqResp, ContextBytesType, Protocol, Encoding} from "@lodestar/reqresp";
import {ForkName} from "@lodestar/params";
import {Logger} from "@lodestar/utils";

async function getReqResp(libp2p: Libp2p, logger: Logger): Promise<void> {
  const reqResp = new ReqResp({libp2p, logger, metricsRegister: null});

  // Register a PONG handler to respond with caller's Ping request
  const pingProtocol: Protocol = {
    method: "ping",
    version: 1,
    encoding: Encoding.SSZ_SNAPPY,
    contextBytes: {type: ContextBytesType.Empty},
    requestSizes: ssz.phase0.Ping,
    responseSizes: () => ssz.phase0.Ping,
    handler: async function* (req) {
      yield {
        data: req.data,
        fork: ForkName.phase0,
      };
    },
  };

  reqResp.registerProtocol(pingProtocol);
}
```

## Prerequisites

- [NodeJS](https://nodejs.org/) (LTS)
- [Yarn](https://classic.yarnpkg.com/lang/en/)

## What you need

You will need to go over the [specification](https://github.com/ethereum/beacon-apis).

## Getting started

- Follow the [installation guide](https://chainsafe.github.io/lodestar/) to install Lodestar.
- Quickly try out the whole stack by [starting a local testnet](https://chainsafe.github.io/lodestar/advanced-topics/setting-up-a-testnet/).

## Contributors

Read our [contributors document](/CONTRIBUTING.md), [submit an issue](https://github.com/ChainSafe/lodestar/issues/new/choose) or talk to us on our [discord](https://discord.gg/yjyvFRP)!

## License

Apache-2.0 [ChainSafe Systems](https://chainsafe.io)
