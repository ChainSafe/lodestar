<p align="center"><a href="https://chainsafe.github.io/lodestar"><img width="500" title="Lodestar" src='assets/lodestar_icon_text_black_stroke.png' /></a></p>

# Lodestar Ethereum Consensus Implementation

[![GitHub release (latest by date)](https://img.shields.io/github/v/release/chainsafe/lodestar?label=Github)](https://github.com/ChainSafe/lodestar/releases/latest)
[![Docker Image Version (latest by date)](https://img.shields.io/docker/v/chainsafe/lodestar?color=blue&label=Docker&sort=semver)](https://hub.docker.com/r/chainsafe/lodestar)
[![Eth Consensus Spec v1.4.0](https://img.shields.io/badge/ETH%20consensus--spec-1.4.0-blue)](https://github.com/ethereum/consensus-specs/releases/tag/v1.4.0)
![ES Version](https://img.shields.io/badge/ES-2021-yellow)
![Node Version](https://img.shields.io/badge/node-22.x-green)
[![codecov](https://codecov.io/gh/ChainSafe/lodestar/graph/badge.svg)](https://codecov.io/gh/ChainSafe/lodestar)
[![gitpoap badge](https://public-api.gitpoap.io/v1/repo/ChainSafe/lodestar/badge)](https://www.gitpoap.io/gh/ChainSafe/lodestar)


[Lodestar](https://lodestar.chainsafe.io) is a TypeScript implementation of the [Ethereum Consensus specification](https://github.com/ethereum/consensus-specs) developed by [ChainSafe Systems](https://chainsafe.io).

## Getting started

- :gear: Follow the instructions for [build from source](https://chainsafe.github.io/lodestar/run/getting-started/installation#build-from-source), [binaries](https://chainsafe.github.io/lodestar/run/getting-started/installation#binaries), or [Docker](https://chainsafe.github.io/lodestar/run/getting-started/installation#docker-installation) to install Lodestar. Or use our [Lodestar Quickstart scripts](https://github.com/ChainSafe/lodestar-quickstart).
- :books: Use [Lodestar libraries](https://chainsafe.github.io/lodestar/supporting-libraries/libraries/) in your next Ethereum Typescript project.
- :globe_with_meridians: Run a beacon node on [mainnet or a public testnet](https://chainsafe.github.io/lodestar/run/beacon-management/starting-a-node/).
- :computer: Utilize the whole stack by [starting a local testnet](https://chainsafe.github.io/lodestar/contribution/advanced-topics/setting-up-a-testnet/).
- :spiral_notepad: View the Lodestar [CLI commands and options](https://chainsafe.github.io/lodestar/reference/cli/).
- :nerd_face: View the [Package and dependency structure](https://chainsafe.github.io/lodestar/contribution/depgraph/).
- :memo: Prospective contributors can read the [contributing section](./CONTRIBUTING.md) to understand how we develop and test on Lodestar.
- :writing_hand: If you have questions [submit an issue](https://github.com/ChainSafe/lodestar/issues/new/choose) or join us on [Discord](https://discord.gg/yjyvFRP)!
  [![Discord](https://img.shields.io/discord/593655374469660673.svg?label=Discord&logo=discord)](https://discord.gg/aMxzVcr)
- :rotating_light: Please note our [security policy](./SECURITY.md).
- :bird: Follow Lodestar on [Twitter](https://twitter.com/lodestar_eth) for announcements and updates! [![Twitter Follow](https://img.shields.io/twitter/follow/lodestar_eth)](https://twitter.com/lodestar_eth)
- ✨ Ask [Lodestar Guru](https://gurubase.io/g/lodestar), an AI focused on Lodestar, to answer your questions based on data from Lodestar Docs. [![](https://img.shields.io/badge/Gurubase-Ask%20Lodestar%20Guru-006BFF)](https://gurubase.io/g/lodestar) 

## Prerequisites

- :gear: [NodeJS](https://nodejs.org/) (LTS)
- :toolbox: [Yarn](https://classic.yarnpkg.com/lang/en/)

###### Developer Quickstart:

```bash
yarn install
yarn build
./lodestar --help
```

## Architecture Overview

- :package: This mono-repository contains a suite of Ethereum Consensus packages.
- :balance_scale: The mono-repository is released under [LGPLv3 license](./LICENSE). Note, that the packages contain their own licenses.

| Package                                                     | Version                                                                                                                     | License                                                                                                               | Docs                                                                                      | Description                                                                    |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| [`@chainsafe/lodestar`](./packages/cli)                     | [![npm](https://img.shields.io/npm/v/@chainsafe/lodestar)](https://www.npmjs.com/package/@chainsafe/lodestar)               | [![License: LGPL v3](https://img.shields.io/badge/License-LGPL%20v3-blue.svg)](https://www.gnu.org/licenses/lgpl-3.0) | [![documentation](https://img.shields.io/badge/readme-blue)](./packages/cli/)             | :computer: Command-line tool for Lodestar                                      |
| [`@lodestar/api`](./packages/api)                           | [![npm](https://img.shields.io/npm/v/@lodestar/api)](https://www.npmjs.com/package/@lodestar/api)                           | [![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)  | [![documentation](https://img.shields.io/badge/readme-blue)](./packages/api)              | :clipboard: REST Client for the Ethereum Beacon API                            |
| [`@lodestar/beacon-node`](./packages/beacon-node)           | [![npm](https://img.shields.io/npm/v/@lodestar/beacon-node)](https://www.npmjs.com/package/@lodestar/beacon-node)           | [![License: LGPL v3](https://img.shields.io/badge/License-LGPL%20v3-blue.svg)](https://www.gnu.org/licenses/lgpl-3.0) | [![documentation](https://img.shields.io/badge/readme-blue)](./packages/beacon-node)      | :rotating_light: Beacon-chain client                                           |
| [`@lodestar/config`](./packages/config)                     | [![npm](https://img.shields.io/npm/v/@lodestar/config)](https://www.npmjs.com/package/@lodestar/config)                     | [![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)  | [![documentation](https://img.shields.io/badge/readme-blue)](./packages/config)           | :spiral_notepad: Eth Consensus types and params bundled together               |
| [`@lodestar/db`](./packages/db)                             | [![npm](https://img.shields.io/npm/v/@lodestar/db)](https://www.npmjs.com/package/@lodestar/db)                             | [![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)  | [![documentation](https://img.shields.io/badge/readme-blue)](./packages/db)               | :floppy_disk: Read/write persistent Eth Consensus data                         |
| [`@lodestar/flare`](./packages/flare)                       | [![npm](https://img.shields.io/npm/v/@lodestar/flare)](https://www.npmjs.com/package/@lodestar/flare)                       | [![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)  | [![documentation](https://img.shields.io/badge/readme-blue)](./packages/flare)            | :boom: Command tool for triggering non-standard actions                        |
| [`@lodestar/fork-choice`](./packages/fork-choice)           | [![npm](https://img.shields.io/npm/v/@lodestar/fork-choice)](https://www.npmjs.com/package/@lodestar/fork-choice)           | [![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)  | [![documentation](https://img.shields.io/badge/readme-blue)](./packages/fork-choice)      | :fork_and_knife: Beacon-chain fork choice                                      |
| [`@lodestar/light-client`](./packages/light-client)         | [![npm](https://img.shields.io/npm/v/@lodestar/light-client)](https://www.npmjs.com/package/@lodestar/light-client)         | [![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)  | [![documentation](https://img.shields.io/badge/readme-blue)](./packages/light-client)     | :bird: Ethereum Light client                                                   |
| [`@lodestar/logger`](./packages/logger)                     | [![npm](https://img.shields.io/npm/v/@lodestar/logger)](https://www.npmjs.com/package/@lodestar/logger)                     | [![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)  | [![documentation](https://img.shields.io/badge/readme-blue)](./packages/logger)           | :memo: NodeJS logger for Lodestar binaries                                     |
| [`@lodestar/params`](./packages/params)                     | [![npm](https://img.shields.io/npm/v/@lodestar/params)](https://www.npmjs.com/package/@lodestar/params)                     | [![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)  | [![documentation](https://img.shields.io/badge/readme-blue)](./packages/params)           | :spider_web: Eth Consensus network parameters                                  |
| [`@lodestar/prover`](./packages/prover)                     | [![npm](https://img.shields.io/npm/v/@lodestar/prover)](https://www.npmjs.com/package/@lodestar/prover)                     | [![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)  | [![documentation](https://img.shields.io/badge/readme-blue)](./packages/prover)           | :white_check_mark: Ethereum Light client verifier for execution JSON-RPC calls |
| [`@lodestar/reqresp`](./packages/reqresp)                   | [![npm](https://img.shields.io/npm/v/@lodestar/reqresp)](https://www.npmjs.com/package/@lodestar/reqresp)                   | [![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)  | [![documentation](https://img.shields.io/badge/readme-blue)](./packages/reqresp)          | :telephone_receiver: Eth Consensus Req/Resp protocol                           |
| [`@lodestar/spec-test-util`](./packages/spec-test-util)     | [![npm](https://img.shields.io/npm/v/@lodestar/spec-test-util)](https://www.npmjs.com/package/@lodestar/spec-test-util)     | [![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)  | [![documentation](https://img.shields.io/badge/readme-blue)](./packages/spec-test-util)   | :test_tube: Test harness for Eth Consensus spec tests                          |
| [`@lodestar/state-transition`](./packages/state-transition) | [![npm](https://img.shields.io/npm/v/@lodestar/state-transition)](https://www.npmjs.com/package/@lodestar/state-transition) | [![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)  | [![documentation](https://img.shields.io/badge/readme-blue)](./packages/state-transition) | :mag_right: Eth Consensus beacon-state transition                              |
| [`@lodestar/types`](./packages/types)                       | [![npm](https://img.shields.io/npm/v/@lodestar/types)](https://www.npmjs.com/package/@lodestar/types)                       | [![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)  | [![documentation](https://img.shields.io/badge/readme-blue)](./packages/types)            | :spiral_notepad: Eth Consensus TypeScript and SSZ types                        |
| [`@lodestar/utils`](./packages/utils)                       | [![npm](https://img.shields.io/npm/v/@lodestar/utils)](https://www.npmjs.com/package/@lodestar/utils)                       | [![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)  | [![documentation](https://img.shields.io/badge/readme-blue)](./packages/utils)            | :toolbox: Miscellaneous utility functions used across Lodestar                 |
| [`@lodestar/validator`](./packages/validator)               | [![npm](https://img.shields.io/npm/v/@lodestar/validator)](https://www.npmjs.com/package/@lodestar/validator)               | [![License: LGPL v3](https://img.shields.io/badge/License-LGPL%20v3-blue.svg)](https://www.gnu.org/licenses/lgpl-3.0) | [![documentation](https://img.shields.io/badge/readme-blue)](./packages/validator)        | :bank: Validator client                                                        |

## Contributors

Read our [contributors document](/CONTRIBUTING.md), [submit an issue](https://github.com/ChainSafe/lodestar/issues/new/choose) or talk to us on our [Discord](https://discord.gg/yjyvFRP)!

## Meetings

Weekly contributor meetings are public and announced on Discord. Feel free to check out our meeting notes and documents on [HackMD](https://hackmd.io/@wemeetagain/rJTEOdqPS/%2FXBzvaQgMTyyMJuToWAEDjw). Post-September 2021, meeting notes can be found on the [Lodestar Wiki Page](https://github.com/ChainSafe/lodestar/wiki).

## Donations

We are a local group of Toronto open-source developers. As such, all of our open-source work is funded by grants. We all take the time out of our hectic lives to contribute to the Ethereum ecosystem.
If you want to donate, you can send us ETH at the following address: `lodestar.chainsafe.eth`
