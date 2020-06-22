![lodestar logo](/assets/300ppi/FullMark-BLACK.png)

# Lodestar Monorepo

![ETH2.0_Spec_Version 0.11.1](https://img.shields.io/badge/ETH2.0_Spec_Version-0.11.1-2e86c1.svg)
[![Discord](https://img.shields.io/discord/593655374469660673.svg?label=Discord&logo=discord)](https://discord.gg/aMxzVcr)
[![codecov](https://codecov.io/gh/ChainSafe/lodestar/branch/master/graph/badge.svg)](https://codecov.io/gh/ChainSafe/lodestar)
[![Maintainability](https://api.codeclimate.com/v1/badges/678099476c401e1af503/maintainability)](https://codeclimate.com/github/ChainSafe/lodestar/maintainability)

Lodestar is a Typescript implementation of the Ethereum 2.0 specification developed by ChainSafe.

## Getting started

- Follow the [installation guide](https://chainsafe.github.io/lodestar/installation) to install Lodestar.
- Quickly try out the whole stack by [starting a local testnet](https://chainsafe.github.io/lodestar/usage).
- View the [typedoc code docs](https://chainsafe.github.io/lodestar/packages).
- If you have questions [submit an issue](https://github.com/ChainSafe/lodestar/issues/new) or join us on [discord](https://discord.gg/yjyvFRP)!

## Index

- [Tl;Dr](#tldr)
- [Prerequisites](#prerequisites)
- [Getting Started](#getting-started)
- [Contributors](#contributors)
- [Meeting Notes](#meeting-notes)
- [Donations](#donations)
- [Packages](#packages)

## Contributors

Read our [contributors document](/CONTRIBUTING.md), [submit an issue](https://github.com/ChainSafe/lodestar/issues/new/choose) or talk to us on our [discord](https://discord.gg/yjyvFRP)!

## Meeting Notes

Feel free to check out our meeting notes and documents on [HackMD](https://hackmd.io/@wemeetagain/rJTEOdqPS/%2F%40yBpKEsxORheI8AJoIiZj1Q%2FHk_b8XfcV%2F%252F6pRB5amJRLKBGEkeOJA8Cw).

## Donations

We are a local group of Toronto open source developers. As such, all of our open source work is funded by grants. We all take the time out of our hectic lives to contribute to the Ethereum ecosystem.
If you want to donate, you can send us ETH at the following address: **lodestar.chainsafe.eth**

## Packages

This monorepo repository contains a suite of Ethereum 2.0 packages.

| Package                                                                                                                                    | Version                                                                                                                                                       | License                                                                                                               | Docs                                                                                                                                                      | Description                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| [@chainsafe/lodestar](https://github.com/ChainSafe/lodestar/tree/master/packages/lodestar)                                                 | [![npm](https://img.shields.io/npm/v/@chainsafe/lodestar)](https://www.npmjs.com/package/@chainsafe/lodestar)                                                 | [![License: LGPL v3](https://img.shields.io/badge/License-LGPL%20v3-blue.svg)](https://www.gnu.org/licenses/lgpl-3.0) | [![documentation](https://img.shields.io/badge/typedoc-blue)](https://chainsafe.github.io/lodestar/lodestar)                                              | Beacon chain client                         |
| [@chainsafe/lodestar-validator](https://github.com/ChainSafe/lodestar/tree/master/packages/lodestar-validator)                             | [![npm](https://img.shields.io/npm/v/@chainsafe/lodestar-validator)](https://www.npmjs.com/package/@chainsafe/lodestar-validator)                             | [![License: LGPL v3](https://img.shields.io/badge/License-LGPL%20v3-blue.svg)](https://www.gnu.org/licenses/lgpl-3.0) | [![documentation](https://img.shields.io/badge/typedoc-blue)](https://chainsafe.github.io/lodestar/lodestar-validator)                                    | Validator client                            |
| [@chainsafe/lodestar-cli](https://github.com/ChainSafe/lodestar/tree/master/packages/lodestar-cli)                                         | [![npm](https://img.shields.io/npm/v/@chainsafe/lodestar-cli)](https://www.npmjs.com/package/@chainsafe/lodestar-cli)                                         | [![License: LGPL v3](https://img.shields.io/badge/License-LGPL%20v3-blue.svg)](https://www.gnu.org/licenses/lgpl-3.0) | [![documentation](https://img.shields.io/badge/typedoc-blue)](https://chainsafe.github.io/lodestar/lodestar-cli)                                          | Command line tool for lodestar              |
| [@chainsafe/lodestar-beacon-state-transition](https://github.com/ChainSafe/lodestar/tree/master/packages/lodestar-beacon-state-transition) | [![npm](https://img.shields.io/npm/v/@chainsafe/lodestar-beacon-state-transition)](https://www.npmjs.com/package/@chainsafe/lodestar-beacon-state-transition) | [![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)  | [![documentation](https://img.shields.io/badge/readme-blue)](https://github.com/ChainSafe/lodestar/tree/master/packages/lodestar-beacon-state-transition) | Eth2 beacon state transition                |
| [@chainsafe/lodestar-types](https://github.com/ChainSafe/lodestar/tree/master/packages/lodestar-types)                                     | [![npm](https://img.shields.io/npm/v/@chainsafe/lodestar-types)](https://www.npmjs.com/package/@chainsafe/lodestar-types)                                     | [![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)  | [![documentation](https://img.shields.io/badge/readme-blue)](https://github.com/ChainSafe/lodestar/tree/master/packages/lodestar-types)                   | Eth2 typescript and SSZ types               |
| [@chainsafe/lodestar-params](https://github.com/ChainSafe/lodestar/tree/master/packages/lodestar-params)                                   | [![npm](https://img.shields.io/npm/v/@chainsafe/lodestar-params)](https://www.npmjs.com/package/@chainsafe/lodestar-params)                                   | [![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)  | [![documentation](https://img.shields.io/badge/readme-blue)](https://github.com/ChainSafe/lodestar/tree/master/packages/lodestar-params)                  | Eth2 network parameters                     |
| [@chainsafe/lodestar-utils](https://github.com/ChainSafe/lodestar/tree/master/packages/lodestar-utils)                                     | [![npm](https://img.shields.io/npm/v/@chainsafe/lodestar-utils)](https://www.npmjs.com/package/@chainsafe/lodestar-utils)                                     | [![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)  | [![documentation](https://img.shields.io/badge/typedoc-blue)](https://chainsafe.github.io/lodestar/lodestar-utils)                                        | Misc utility functions used across lodestar |
| [@chainsafe/lodestar-config](https://github.com/ChainSafe/lodestar/tree/master/packages/lodestar-config)                                   | [![npm](https://img.shields.io/npm/v/@chainsafe/lodestar-config)](https://www.npmjs.com/package/@chainsafe/lodestar-config)                                   | [![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)  | [![documentation](https://img.shields.io/badge/typedoc-blue)](https://chainsafe.github.io/lodestar/lodestar-config)                                       | Eth2 types and params bundled together      |
| [@chainsafe/lodestar-spec-test-util](https://github.com/ChainSafe/lodestar/tree/master/packages/lodestar-spec-test-util)                   | [![npm](https://img.shields.io/npm/v/@chainsafe/lodestar-spec-test-util)](https://www.npmjs.com/package/@chainsafe/lodestar-spec-test-util)                   | [![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)  | [![documentation](https://img.shields.io/badge/typedoc-blue)](https://chainsafe.github.io/lodestar/lodestar-spec-test-util)                               | Test harness for Eth2 spec tests            |
