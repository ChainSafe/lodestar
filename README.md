![lodestar logo](./assets/300ppi/FullMark-BLACK.png)

[WIP]

# Lodestar Monorepo
![ETH2.0_Spec_Version 0.10.1](https://img.shields.io/badge/ETH2.0_Spec_Version-0.10.1-2e86c1.svg)
[![Discord](https://img.shields.io/discord/593655374469660673.svg?label=Discord&logo=discord)](https://discord.gg/aMxzVcr)
[![codecov](https://codecov.io/gh/ChainSafe/lodestar/branch/master/graph/badge.svg)](https://codecov.io/gh/ChainSafe/lodestar)
[![Maintainability](https://api.codeclimate.com/v1/badges/678099476c401e1af503/maintainability)](https://codeclimate.com/github/ChainSafe/lodestar/maintainability)

Welcome to the ChainSafe lodestar monorepo!
This repository contains a suite of Ethereum 2.0 packages.

## Index
* [Tl;Dr](#tldr)
* [Prerequisites](#prerequisites)
* [Getting Started](#getting-started)
* [Contributors](#contributors)
* [Meeting Notes](#meeting-notes)
* [Donations](#donations)
* [Packages](#packages)

## Tl;Dr:

Lodestar is a Typescript implementation of the Eth 2 Beacon chain spec.

## Prerequisites

* [Lerna](https://github.com/lerna/lerna)
* [Yarn](https://yarnpkg.com/)

## Getting Started

To get an instance of Lodestar up & running, start a terminal from the root of the this repo:

1. Install dependencies accross all packages:
```
yarn install
```

2. Run the build script:
```
yarn run build
```

3. Lodestar should now be ready for use:
```
yarn run cli --help
```

## Contributors
Read our [contributors document](/CONTRIBUTING.md), [submit an issue](https://github.com/ChainSafe/lodestar/issues/new/choose) or talk to us on our [discord](https://discord.gg/yjyvFRP)!

## Meeting Notes
Feel free to check out our meeting notes and documents on [HackMD](https://hackmd.io/@wemeetagain/rJTEOdqPS/%2F%40yBpKEsxORheI8AJoIiZj1Q%2FHk_b8XfcV%2F%252F6pRB5amJRLKBGEkeOJA8Cw).

## Donations
We are a local group of Toronto open source developers. As such, all of our open source work is funded by grants. We all take the time out of our hectic lives to contribute to the Ethereum ecosystem.
If you want to donate, you can send us ETH at the following address: **lodestar.chainsafe.eth**

## Packages

### [@chainsafe/lodestar](/packages/lodestar)
Beacon chain implementation

[![npm](https://img.shields.io/npm/v/@chainsafe/lodestar)](https://www.npmjs.com/package/@chainsafe/lodestar)
[![License: LGPL v3](https://img.shields.io/badge/License-LGPL%20v3-blue.svg)](https://www.gnu.org/licenses/lgpl-3.0)
[![documentation](https://img.shields.io/badge/documentation-typedoc-blue)](https://chainsafe.github.io/lodestar/lodestar)

### [@chainsafe/lodestar-validator](/packages/lodestar-validator)
Eth2 validator client implementation

[![npm](https://img.shields.io/npm/v/@chainsafe/lodestar-validator)](https://www.npmjs.com/package/@chainsafe/lodestar-validator)
[![License: LGPL v3](https://img.shields.io/badge/License-LGPL%20v3-blue.svg)](https://www.gnu.org/licenses/lgpl-3.0)
[![documentation](https://img.shields.io/badge/documentation-typedoc-blue)](https://chainsafe.github.io/lodestar/lodestar)


### [@chainsafe/lodestar-types](/packages/lodestar-types)
Typescript types for Ethereum 2.0 datastructures

[![npm](https://img.shields.io/npm/v/@chainsafe/lodestar-types)](https://www.npmjs.com/package/@chainsafe/lodestar-types)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![documentation](https://img.shields.io/badge/documentation-typedoc-blue)](https://chainsafe.github.io/lodestar/lodestar-types)

### [@chainsafe/lodestar-params](/packages/lodestar-params)
Beacon chain parameters

[![npm](https://img.shields.io/npm/v/@chainsafe/lodestar-params)](https://www.npmjs.com/package/@chainsafe/lodestar-params)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![documentation](https://img.shields.io/badge/documentation-typedoc-blue)](https://chainsafe.github.io/lodestar/lodestar-params)

### [@chainsafe/lodestar-utils](/packages/lodestar-utils)
Utility methods used throughout Lodestar modules.

[![npm](https://img.shields.io/npm/v/@chainsafe/lodestar-utils)](https://www.npmjs.com/package/@chainsafe/lodestar-utils)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![documentation](https://img.shields.io/badge/documentation-typedoc-blue)](https://chainsafe.github.io/lodestar/lodestar-utils)

### [@chainsafe/lodestar-config](/packages/lodestar-config)
Beacon chain configuration

[![npm](https://img.shields.io/npm/v/@chainsafe/lodestar-config)](https://www.npmjs.com/package/@chainsafe/lodestar-config)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![documentation](https://img.shields.io/badge/documentation-typedoc-blue)](https://chainsafe.github.io/lodestar/lodestar-config)

### [@chainsafe/lodestar-beacon-state-transition](/packages/lodestar-beacon-state-transition)
Beacon chain state transition

[![npm](https://img.shields.io/npm/v/@chainsafe/lodestar-beacon-state-transition)](https://www.npmjs.com/package/@chainsafe/lodestar-beacon-state-transition)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![documentation](https://img.shields.io/badge/documentation-typedoc-blue)](https://chainsafe.github.io/lodestar/lodestar-beacon-state-transition)

### [@chainsafe/lodestar-spec-test-util](/packages/lodestar-spec-test-util)
Ethereum 2.0 spec test utilities

[![npm](https://img.shields.io/npm/v/@chainsafe/lodestar-spec-test-util)](https://www.npmjs.com/package/@chainsafe/lodestar-spec-test-util)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![documentation](https://img.shields.io/badge/documentation-typedoc-blue)](https://chainsafe.github.io/lodestar/lodestar-spec-test-util)