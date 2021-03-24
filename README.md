<p align="center"><a href="https://chainsafe.github.io/lodestar"><img width="400" title="Lodestar" src='assets/300ppi/FullMark-BLACK-Stroke-WHITE.png' /></a></p>

# Lodestar Monorepo

![ETH2.0_Spec_Version 0.12.1](https://img.shields.io/badge/ETH2.0_Spec_Version-0.12.1-2e86c1.svg)
[![Discord](https://img.shields.io/discord/593655374469660673.svg?label=Discord&logo=discord)](https://discord.gg/aMxzVcr)
[![codecov](https://codecov.io/gh/ChainSafe/lodestar/branch/master/graph/badge.svg)](https://codecov.io/gh/ChainSafe/lodestar)
[![Maintainability](https://api.codeclimate.com/v1/badges/678099476c401e1af503/maintainability)](https://codeclimate.com/github/ChainSafe/lodestar/maintainability)
![ES Version](https://img.shields.io/badge/ES-2020-yellow)
![Node Version](https://img.shields.io/badge/node-12.x-green)

[Lodestar](https://lodestar.chainsafe.io) is a Typescript implementation of the Ethereum 2.0 specification developed by [ChainSafe Systems](https://chainsafe.io).

## Index

- [Prerequisites](#prerequisites)
- [Getting Started](#getting-started)
- [Contributors](#contributors)
- [Meeting Notes](#meeting-notes)
- [Donations](#donations)
- [Packages](#packages)
- [Creating Release](#creating-release)

## Getting started

- Follow the [installation guide](https://chainsafe.github.io/lodestar/installation) to install Lodestar.
- Run lodestar on the [eth2 mainnet or on a public testnet](https://chainsafe.github.io/lodestar/usage/testnet/)
- Quickly try out the whole stack by [starting a local testnet](https://chainsafe.github.io/lodestar/usage/local).
- View the lodestar [cli commands and options](https://chainsafe.github.io/lodestar/reference/cli/)
- View the [typedoc code docs](https://chainsafe.github.io/lodestar/packages).
- If you have questions [submit an issue](https://github.com/ChainSafe/lodestar/issues/new) or join us on [discord](https://discord.gg/yjyvFRP)!

## Prerequisites

- [Yarn](https://yarnpkg.com/)

## Architecture Overview

- See [architecure docs](https://chainsafe.github.io/lodestar/design/architecture/) for Lodestar

## Contributors

Read our [contributors document](/CONTRIBUTING.md), [submit an issue](https://github.com/ChainSafe/lodestar/issues/new/choose) or talk to us on our [discord](https://discord.gg/yjyvFRP)!

## Meeting Notes

Feel free to check out our meeting notes and documents on [HackMD](https://hackmd.io/@wemeetagain/rJTEOdqPS/%2F%40yBpKEsxORheI8AJoIiZj1Q%2FHk_b8XfcV%2F%252F6pRB5amJRLKBGEkeOJA8Cw).

## Donations

We are a local group of Toronto open source developers. As such, all of our open source work is funded by grants. We all take the time out of our hectic lives to contribute to the Ethereum ecosystem.
If you want to donate, you can send us ETH at the following address: **lodestar.chainsafe.eth**

## Packages

This monorepo repository contains a suite of Ethereum 2.0 packages.

| Package                                                                                                                           | Version                                                                                                                                                       | License                                                                                                               | Docs                                                                                                                                             | Description                                 |
| --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------- |
| [@chainsafe/lodestar](https://github.com/ChainSafe/lodestar/tree/master/packages/lodestar)                                        | [![npm](https://img.shields.io/npm/v/@chainsafe/lodestar)](https://www.npmjs.com/package/@chainsafe/lodestar)                                                 | [![License: LGPL v3](https://img.shields.io/badge/License-LGPL%20v3-blue.svg)](https://www.gnu.org/licenses/lgpl-3.0) | [![documentation](https://img.shields.io/badge/typedoc-blue)](https://chainsafe.github.io/lodestar/lodestar)                                     | Beacon chain client                         |
| [@chainsafe/lodestar-validator](https://github.com/ChainSafe/lodestar/tree/master/packages/validator)                             | [![npm](https://img.shields.io/npm/v/@chainsafe/lodestar-validator)](https://www.npmjs.com/package/@chainsafe/lodestar-validator)                             | [![License: LGPL v3](https://img.shields.io/badge/License-LGPL%20v3-blue.svg)](https://www.gnu.org/licenses/lgpl-3.0) | [![documentation](https://img.shields.io/badge/typedoc-blue)](https://chainsafe.github.io/lodestar/lodestar-validator)                           | Validator client                            |
| [@chainsafe/lodestar-cli](https://github.com/ChainSafe/lodestar/tree/master/packages/cli)                                         | [![npm](https://img.shields.io/npm/v/@chainsafe/lodestar-cli)](https://www.npmjs.com/package/@chainsafe/lodestar-cli)                                         | [![License: LGPL v3](https://img.shields.io/badge/License-LGPL%20v3-blue.svg)](https://www.gnu.org/licenses/lgpl-3.0) | [![documentation](https://img.shields.io/badge/typedoc-blue)](https://chainsafe.github.io/lodestar/lodestar-cli)                                 | Command line tool for lodestar              |
| [@chainsafe/lodestar-beacon-state-transition](https://github.com/ChainSafe/lodestar/tree/master/packages/beacon-state-transition) | [![npm](https://img.shields.io/npm/v/@chainsafe/lodestar-beacon-state-transition)](https://www.npmjs.com/package/@chainsafe/lodestar-beacon-state-transition) | [![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)  | [![documentation](https://img.shields.io/badge/readme-blue)](https://github.com/ChainSafe/lodestar/tree/master/packages/beacon-state-transition) | Eth2 beacon state transition                |
| [@chainsafe/lodestar-types](https://github.com/ChainSafe/lodestar/tree/master/packages/types)                                     | [![npm](https://img.shields.io/npm/v/@chainsafe/lodestar-types)](https://www.npmjs.com/package/@chainsafe/lodestar-types)                                     | [![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)  | [![documentation](https://img.shields.io/badge/readme-blue)](https://github.com/ChainSafe/lodestar/tree/master/packages/types)                   | Eth2 typescript and SSZ types               |
| [@chainsafe/lodestar-params](https://github.com/ChainSafe/lodestar/tree/master/packages/params)                                   | [![npm](https://img.shields.io/npm/v/@chainsafe/lodestar-params)](https://www.npmjs.com/package/@chainsafe/lodestar-params)                                   | [![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)  | [![documentation](https://img.shields.io/badge/readme-blue)](https://github.com/ChainSafe/lodestar/tree/master/packages/params)                  | Eth2 network parameters                     |
| [@chainsafe/lodestar-utils](https://github.com/ChainSafe/lodestar/tree/master/packages/utils)                                     | [![npm](https://img.shields.io/npm/v/@chainsafe/lodestar-utils)](https://www.npmjs.com/package/@chainsafe/lodestar-utils)                                     | [![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)  | [![documentation](https://img.shields.io/badge/typedoc-blue)](https://chainsafe.github.io/lodestar/lodestar-utils)                               | Misc utility functions used across lodestar |
| [@chainsafe/lodestar-config](https://github.com/ChainSafe/lodestar/tree/master/packages/config)                                   | [![npm](https://img.shields.io/npm/v/@chainsafe/lodestar-config)](https://www.npmjs.com/package/@chainsafe/lodestar-config)                                   | [![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)  | [![documentation](https://img.shields.io/badge/typedoc-blue)](https://chainsafe.github.io/lodestar/lodestar-config)                              | Eth2 types and params bundled together      |
| [@chainsafe/lodestar-spec-test-util](https://github.com/ChainSafe/lodestar/tree/master/packages/spec-test-util)                   | [![npm](https://img.shields.io/npm/v/@chainsafe/lodestar-spec-test-util)](https://www.npmjs.com/package/@chainsafe/lodestar-spec-test-util)                   | [![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)  | [![documentation](https://img.shields.io/badge/typedoc-blue)](https://chainsafe.github.io/lodestar/lodestar-spec-test-util)                      | Test harness for Eth2 spec tests            |
| [@chainsafe/lodestar-db](https://github.com/ChainSafe/lodestar/tree/master/packages/db)                                           | [![npm](https://img.shields.io/npm/v/@chainsafe/lodestar-db)](https://www.npmjs.com/package/@chainsafe/lodestar-db)                                           | [![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)  | [![documentation](https://img.shields.io/badge/typedoc-blue)](https://chainsafe.github.io/lodestar/lodestar-db)                                  | Read/write persistent Eth2 data             |
| [@chainsafe/lodestar-fork-choice](https://github.com/ChainSafe/lodestar/tree/master/packages/fork-choice)                         | [![npm](https://img.shields.io/npm/v/@chainsafe/lodestar-fork-choice)](https://www.npmjs.com/package/@chainsafe/lodestar-fork-choice)                         | [![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)  | [![documentation](https://img.shields.io/badge/typedoc-blue)](https://chainsafe.github.io/lodestar/lodestar-fork-choice)                         | Beacon chain fork choice                    |

### Creating Release

- run `yarn run release` in project root directory
- choose version increment
- open PR to master
