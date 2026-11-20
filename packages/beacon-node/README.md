# Lodestar

[![Discord](https://img.shields.io/discord/593655374469660673.svg?label=Discord&logo=discord)](https://discord.gg/aMxzVcr)
[![Eth Consensus Spec v1.5.0](https://img.shields.io/badge/ETH%20consensus--spec-1.5.0-blue)](https://github.com/ethereum/consensus-specs/releases/tag/v1.5.0)
![ES Version](https://img.shields.io/badge/ES-2021-yellow)
![Node Version](https://img.shields.io/badge/node-24.x-green)

> This package is part of [ChainSafe's Lodestar](https://lodestar.chainsafe.io) project

## Prerequisites

- [pnpm](https://pnpm.io/)

## What you need

You will need to go over the [specification](https://github.com/ethereum/consensus-specs).

## Getting started

- Follow the [installation guide](https://chainsafe.github.io/lodestar/) to install Lodestar.
- Quickly try out the whole stack by [starting a local testnet](https://chainsafe.github.io/lodestar/contribution/advanced-topics/setting-up-a-testnet/).

## Gloas builder bid streaming

The beacon node can request builder bids over WebSocket with `--builder.bidStream`. The option defaults to `false` and applies only to Gloas. Builder URLs and request authentication still come from the validator client's builder configuration; the pre-Gloas `--builder` switch is not required.

Streaming preserves the configured `--builder.bidDelay`, `--builder.bidDeadline` and `--builder.bidRequests`. Each request round opens its own stream and keeps the latest matching bid, including a lower replacement. Distinct offers collected across rounds remain subject to the normal bid validation and selection rules.

If a connection fails before the WebSocket upgrade, the client can fall back to HTTP using only that round's remaining deadline. An established stream does not trigger an HTTP retry when it closes or receives invalid frames. Bids still pass the normal parent, signature, payment and collateral checks before selection.

## Contributors

Read our [contributors document](/CONTRIBUTING.md), [submit an issue](https://github.com/ChainSafe/lodestar/issues/new/choose) or talk to us on our [discord](https://discord.gg/yjyvFRP)!

## License

Apache-2.0 [ChainSafe Systems](https://chainsafe.io)
