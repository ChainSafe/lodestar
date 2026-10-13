# Lodestar Builder

[![Discord](https://img.shields.io/discord/593655374469660673.svg?label=Discord&logo=discord)](https://discord.gg/aMxzVcr)
[![Eth Consensus Spec v1.7.0-beta.4](https://img.shields.io/badge/ETH%20consensus--spec-1.7.0_beta.4-blue)](https://github.com/ethereum/consensus-specs/releases/tag/v1.7.0-beta.4)
![ES Version](https://img.shields.io/badge/ES-2021-yellow)
![Node Version](https://img.shields.io/badge/node-24.x-green)

> This package is part of [ChainSafe's Lodestar](https://lodestar.chainsafe.io) project

Typescript implementation of the Ethereum Consensus builder client.

## Getting started

- Follow the [installation guide](https://chainsafe.github.io/lodestar/) to install Lodestar.
- Quickly try out the whole stack by [starting a local testnet](https://chainsafe.github.io/lodestar/contribution/advanced-topics/setting-up-a-testnet/).

## Requirements

- A beacon node started with `--emitPayloadAttributes`, the builder bids on the `payload_attributes` events it emits for every slot. Without the flag a beacon node only emits them for slots it proposes itself.
- An execution client the builder can send `engine_forkchoiceUpdated` and `engine_getPayload` to, configured with `--execution.urls` and `--jwtSecret`. Payload IDs are local to one execution client, so only one url is supported.

## License

Apache-2.0 [ChainSafe Systems](https://chainsafe.io)
