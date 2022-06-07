<p align="center"><a href="https://chainsafe.github.io/lodestar"><img width="500" title="Lodestar" src='assets/lodestar_icon_text_black_stroke.png' /></a></p>

# Lodestar Ethereum Consensus Implementation

[![GitHub release (latest by date)](https://img.shields.io/github/v/release/chainsafe/lodestar?label=Github)](https://github.com/ChainSafe/lodestar/releases/latest)
[![npm](https://img.shields.io/npm/v/@chainsafe/lodestar-cli)](https://www.npmjs.com/package/@chainsafe/lodestar-cli)
[![Docker Image Version (latest by date)](https://img.shields.io/docker/v/chainsafe/lodestar?color=blue&label=Docker&sort=semver)](https://hub.docker.com/r/chainsafe/lodestar)
[![Eth Consensus Spec v1.1.10](https://img.shields.io/badge/ETH%20consensus--spec-1.1.10-blue)](https://github.com/ethereum/consensus-specs/releases/tag/v1.1.10)
[![codecov](https://codecov.io/gh/ChainSafe/lodestar/branch/unstable/graph/badge.svg)](https://codecov.io/gh/ChainSafe/lodestar)
[![Maintainability](https://api.codeclimate.com/v1/badges/678099476c401e1af503/maintainability)](https://codeclimate.com/github/ChainSafe/lodestar/maintainability)
![ES Version](https://img.shields.io/badge/ES-2020-yellow)
![Node Version](https://img.shields.io/badge/node-16.x-green)

[Lodestar](https://lodestar.chainsafe.io) is a TypeScript implementation of the [Ethereum Consensus specification](https://github.com/ethereum/consensus-specs) developed by [ChainSafe Systems](https://chainsafe.io).

###### Get it from the NPM Registry:

```bash
npm install -g @chainsafe/lodestar-cli
```

###### Get it from the Docker Hub:

```bash
docker pull chainsafe/lodestar
```

## Getting started

- :gear: Follow the [installation guide](https://chainsafe.github.io/lodestar/installation) to install Lodestar.
- :globe_with_meridians: Run lodestar on the [Ethereum beacon chain mainnet or on a public testnet](https://chainsafe.github.io/lodestar/usage/testnet/).
- :computer: Quickly try out the whole stack by [starting a local testnet](https://chainsafe.github.io/lodestar/usage/local).
- :spiral_notepad: View the lodestar [CLI commands and options](https://chainsafe.github.io/lodestar/reference/cli/).
- :nerd_face: View the [TypeDoc code documentation](https://chainsafe.github.io/lodestar/packages).
- :writing_hand: If you have questions [submit an issue](https://github.com/ChainSafe/lodestar/issues/new) or join us on [Discord](https://discord.gg/yjyvFRP)!
  [![Discord](https://img.shields.io/discord/593655374469660673.svg?label=Discord&logo=discord)](https://discord.gg/aMxzVcr)
- :rotating_light: Please note our [security policy](./SECURITY.md).
- :mailbox_with_mail: Sign up to our [mailing list](https://chainsafe.typeform.com/lodestar) for announcements and any critical information about Lodestar.

## Prerequisites

- :gear: [NodeJS](https://nodejs.org/) (LTS/Gallium)
- :toolbox: [Yarn](https://yarnpkg.com/)/[Lerna](https://lerna.js.org/)

###### Developer Quickstart:

```bash
lerna bootstrap
yarn build
./lodestar --help
```

## Architecture Overview

- :package: This mono-repository contains a suite of Ethereum Consensus packages.
- :balance_scale: The mono-repository is released under [LGPLv3 license](./LICENSE). Note, that the packages contain their own licenses.

| Package                                                                                                                           | Version                                                                                                                                                       | License                                                                                                               | Docs                                                                                                                                             | Description                                 |
| --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------- |
| [@chainsafe/lodestar](https://github.com/ChainSafe/lodestar/tree/unstable/packages/lodestar)                                        | [![npm](https://img.shields.io/npm/v/@chainsafe/lodestar)](https://www.npmjs.com/package/@chainsafe/lodestar)                                                 | [![License: LGPL v3](https://img.shields.io/badge/License-LGPL%20v3-blue.svg)](https://www.gnu.org/licenses/lgpl-3.0) | [![documentation](https://img.shields.io/badge/typedoc-blue)](https://chainsafe.github.io/lodestar)                                     | :rotating_light: Beacon-chain client                         |
| [@chainsafe/lodestar-validator](https://github.com/ChainSafe/lodestar/tree/unstable/packages/validator)                             | [![npm](https://img.shields.io/npm/v/@chainsafe/lodestar-validator)](https://www.npmjs.com/package/@chainsafe/lodestar-validator)                             | [![License: LGPL v3](https://img.shields.io/badge/License-LGPL%20v3-blue.svg)](https://www.gnu.org/licenses/lgpl-3.0) | [![documentation](https://img.shields.io/badge/readme-blue)](https://github.com/ChainSafe/lodestar/tree/unstable/packages/validator)                           | :bank: Validator client                            |
| [@chainsafe/lodestar-light-client](https://github.com/ChainSafe/lodestar/tree/unstable/packages/light-client)                             | [![npm](https://img.shields.io/npm/v/@chainsafe/lodestar-light-client)](https://www.npmjs.com/package/@chainsafe/lodestar-light-client)                             | [![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0) | [![documentation](https://img.shields.io/badge/readme-blue)](https://github.com/ChainSafe/lodestar/tree/unstable/packages/light-client)                           | :bird: Ethereum Light client                            |
| [@chainsafe/lodestar-api](https://github.com/ChainSafe/lodestar/tree/unstable/packages/api)                             | [![npm](https://img.shields.io/npm/v/@chainsafe/lodestar-api)](https://www.npmjs.com/package/@chainsafe/lodestar-api)                             | [![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0) | [![documentation](https://img.shields.io/badge/readme-blue)](https://github.com/ChainSafe/lodestar/tree/unstable/packages/api)                           | :clipboard: REST Client for the Eth Beacon API                            |
| [@chainsafe/lodestar-cli](https://github.com/ChainSafe/lodestar/tree/unstable/packages/cli)                                         | [![npm](https://img.shields.io/npm/v/@chainsafe/lodestar-cli)](https://www.npmjs.com/package/@chainsafe/lodestar-cli)                                         | [![License: LGPL v3](https://img.shields.io/badge/License-LGPL%20v3-blue.svg)](https://www.gnu.org/licenses/lgpl-3.0) | [![documentation](https://img.shields.io/badge/typedoc-blue)](https://chainsafe.github.io/lodestar/reference/cli/)                                 | :computer: Command-line tool for Lodestar              |
| [@chainsafe/lodestar-beacon-state-transition](https://github.com/ChainSafe/lodestar/tree/unstable/packages/beacon-state-transition) | [![npm](https://img.shields.io/npm/v/@chainsafe/lodestar-beacon-state-transition)](https://www.npmjs.com/package/@chainsafe/lodestar-beacon-state-transition) | [![License: LGPL v3](https://img.shields.io/badge/License-LGPL%20v3-blue.svg)](https://www.gnu.org/licenses/lgpl-3.0)  | [![documentation](https://img.shields.io/badge/readme-blue)](https://github.com/ChainSafe/lodestar/tree/unstable/packages/beacon-state-transition) | :mag_right: Eth Consensus beacon-state transition                |
| [@chainsafe/lodestar-types](https://github.com/ChainSafe/lodestar/tree/unstable/packages/types)                                     | [![npm](https://img.shields.io/npm/v/@chainsafe/lodestar-types)](https://www.npmjs.com/package/@chainsafe/lodestar-types)                                     | [![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)  | [![documentation](https://img.shields.io/badge/readme-blue)](https://github.com/ChainSafe/lodestar/tree/unstable/packages/types)                   | :spiral_notepad: Eth Consensus TypeScript and SSZ types               |
| [@chainsafe/lodestar-params](https://github.com/ChainSafe/lodestar/tree/unstable/packages/params)                                   | [![npm](https://img.shields.io/npm/v/@chainsafe/lodestar-params)](https://www.npmjs.com/package/@chainsafe/lodestar-params)                                   | [![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)  | [![documentation](https://img.shields.io/badge/readme-blue)](https://github.com/ChainSafe/lodestar/tree/unstable/packages/params)                  | :spider_web: Eth Consensus network parameters                     |
| [@chainsafe/lodestar-utils](https://github.com/ChainSafe/lodestar/tree/unstable/packages/utils)                                     | [![npm](https://img.shields.io/npm/v/@chainsafe/lodestar-utils)](https://www.npmjs.com/package/@chainsafe/lodestar-utils)                                     | [![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)  | [![documentation](https://img.shields.io/badge/readme-blue)](https://github.com/ChainSafe/lodestar/tree/unstable/packages/utils)                               | :toolbox: Miscellaneous utility functions used across Lodestar |
| [@chainsafe/lodestar-config](https://github.com/ChainSafe/lodestar/tree/unstable/packages/config)                                   | [![npm](https://img.shields.io/npm/v/@chainsafe/lodestar-config)](https://www.npmjs.com/package/@chainsafe/lodestar-config)                                   | [![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)  | [![documentation](https://img.shields.io/badge/readme-blue)](https://github.com/ChainSafe/lodestar/tree/unstable/packages/config)                              | :spiral_notepad: Eth Consensus types and params bundled together      |
| [@chainsafe/lodestar-spec-test-util](https://github.com/ChainSafe/lodestar/tree/unstable/packages/spec-test-util)                   | [![npm](https://img.shields.io/npm/v/@chainsafe/lodestar-spec-test-util)](https://www.npmjs.com/package/@chainsafe/lodestar-spec-test-util)                   | [![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)  | [![documentation](https://img.shields.io/badge/readme-blue)](https://github.com/ChainSafe/lodestar/tree/unstable/packages/spec-test-util)                      | :test_tube: Test harness for Eth Consensus spec tests            |
| [@chainsafe/lodestar-spec-test-runner](https://github.com/ChainSafe/lodestar/tree/unstable/packages/spec-test-runner)                   | | [![License: LGPL v3](https://img.shields.io/badge/License-LGPL%20v3-blue.svg)](https://www.gnu.org/licenses/lgpl-3.0)  | | :test_tube: Run all Eth Consensus spec tests            |
| [@chainsafe/lodestar-db](https://github.com/ChainSafe/lodestar/tree/unstable/packages/db)                                           | [![npm](https://img.shields.io/npm/v/@chainsafe/lodestar-db)](https://www.npmjs.com/package/@chainsafe/lodestar-db)                                           | [![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)  | [![documentation](https://img.shields.io/badge/readme-blue)](https://github.com/ChainSafe/lodestar/tree/unstable/packages/db)                                  | :floppy_disk: Read/write persistent Eth Consensus data             |
| [@chainsafe/lodestar-fork-choice](https://github.com/ChainSafe/lodestar/tree/unstable/packages/fork-choice)                         | [![npm](https://img.shields.io/npm/v/@chainsafe/lodestar-fork-choice)](https://www.npmjs.com/package/@chainsafe/lodestar-fork-choice)                         | [![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)  | [![documentation](https://img.shields.io/badge/readme-blue)](https://github.com/ChainSafe/lodestar/tree/unstable/packages/fork-choice)                         | :fork_and_knife: Beacon-chain fork choice                    |

## Contributors

Read our [contributors document](/CONTRIBUTING.md), [submit an issue](https://github.com/ChainSafe/lodestar/issues/new/choose) or talk to us on our [Discord](https://discord.gg/yjyvFRP)!

## Meetings

Weekly contributor meetings are public and announced on Discord. Feel free to check out our meeting notes and documents on [HackMD](https://hackmd.io/@wemeetagain/rJTEOdqPS/%2FXBzvaQgMTyyMJuToWAEDjw). Post-September 2021, meeting notes can be found on the [Lodestar Wiki Page](https://github.com/ChainSafe/lodestar/wiki).

## Donations

We are a local group of Toronto open-source developers. As such, all of our open-source work is funded by grants. We all take the time out of our hectic lives to contribute to the Ethereum ecosystem.
If you want to donate, you can send us ETH at the following address: `lodestar.chainsafe.eth`
