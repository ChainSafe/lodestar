# Lodestar Signer

[![Discord](https://img.shields.io/discord/593655374469660673.svg?label=Discord&logo=discord)](https://discord.gg/aMxzVcr)
[![Eth Consensus Spec v1.7.0-beta.4](https://img.shields.io/badge/ETH%20consensus--spec-1.7.0_beta.4-blue)](https://github.com/ethereum/consensus-specs/releases/tag/v1.7.0-beta.4)
![ES Version](https://img.shields.io/badge/ES-2021-yellow)
![Node Version](https://img.shields.io/badge/node-24.x-green)

> This package is part of [ChainSafe's Lodestar](https://lodestar.chainsafe.io) project

Typescript implementation of the [Ethereum remote signing API](https://github.com/ethereum/remote-signing-api), the
API validator clients use to delegate signing to a separate process holding the validator keys.

## Getting started

- Follow the [installation guide](https://chainsafe.github.io/lodestar/) to install Lodestar.
- Run `lodestar signer` to serve the API for a set of keystores, then point a validator client at it
  with `--externalSigner.url`.

## Features

- Serves `/upcheck`, `/api/v1/eth2/publicKeys` and `/api/v1/eth2/sign/{identifier}` for every message type
  the Lodestar validator client signs.
- Recomputes the signing root from the typed message and rejects requests whose `signingRoot` does not match.
- Owns a slashing protection database. Block and attestation signatures are only produced if they are safe
  with respect to every message signed before, including history imported from an EIP-3076 interchange file.
- Pins the slashing protection database to the genesis validators root of the first protected request and
  rejects requests for other chains.

## License

Apache-2.0 [ChainSafe Systems](https://chainsafe.io)
