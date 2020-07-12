# Command Line Interface for Lodestar
[![Discord](https://img.shields.io/discord/593655374469660673.svg?label=Discord&logo=discord)](https://discord.gg/aMxzVcr)
![ETH2.0_Spec_Version 0.12.1](https://img.shields.io/badge/ETH2.0_Spec_Version-0.12.1-2e86c1.svg)
![ES Version](https://img.shields.io/badge/ES-2020-yellow)
![Node Version](https://img.shields.io/badge/node-12.x-green)

Command line tool for Lodestar

## Getting started

- Follow the [installation guide](https://chainsafe.github.io/lodestar/installation) to install Lodestar.
- Quickly try out the whole stack by [starting a local testnet](https://chainsafe.github.io/lodestar/usage).
- View the [typedoc code docs](https://chainsafe.github.io/lodestar/packages).

### Lodestar

We have an experimental new CLI called `lodestar` which currently provides a subset of the `lodestar` CLI functionality.

`yarn cli beacon init` - this will write a configuration and network identity to disk, by default `./.lodestar`
`yarn cli beacon run` - this will run a beacon node using a configuration from disk, by default `./.lodestar`
