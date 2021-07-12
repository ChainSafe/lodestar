# lodestar-config

[![npm](https://img.shields.io/npm/v/@chainsafe/lodestar-config)](https://www.npmjs.com/package/@chainsafe/lodestar-config)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
![ETH2.0_Spec_Version 1.0.0](https://img.shields.io/badge/ETH2.0_Spec_Version-1.0.0-2e86c1.svg)
![ES Version](https://img.shields.io/badge/ES-2020-yellow)
![Node Version](https://img.shields.io/badge/node-12.x-green)

> This package is part of [ChainSafe's Lodestar](https://lodestar.chainsafe.io) project


Lodestar defines all [network configuration variables](https://github.com/ethereum/eth2.0-specs/tree/dev/configs) defined in the [Ethereum Consensus / Eth2 spec](https://github.com/ethereum/eth2.0-specs). This tooling may be used to configure testnets, ingest mainnet/testnet config variables, or be used in downstream Lodestar libraries.

## Installation

```sh
npm install @chainsafe/lodestar-config
```

## Usage

The Lodestar config package contains several interfaces used in downstream Lodestar libraries:

- `IChainConfig` - Typescript interface, Default (mainnet) values, and matching SSZ helper type object
- `IForkConfig` - A fork helper object that's structured around the fork schedule
- `IChainForkConfig` A wrapper object that implements `IChainConfig` and `IForkConfig`
- `ICachedGenesis` - A helper object for caching domains (which relies on the genesis validators root)
- `IBeaconConfig` - A wrapper object that implements all above interfaces

### Chain config

The Ethereum consensus spec defines a bunch of variables that may be easily configured per testnet. These include the `GENESIS_TIME`, `SECONDS_PER_SLOT`, and various `*_FORK_EPOCH`s, `*_FORK_VERSION`s, etc. The Lodestar config package exports the `IChainConfig` interface and matching `ChainConfig` SSZ type, which include all of these variables, named verbatim from the spec.

```ts
import {IChainConfig} from "@chainsafe/lodestar-config";

let chainConfig: IChainConfig;
const x: number = chainConfig.SECONDS_PER_SLOT;
```

Mainnet default values are available as a singleton `IChainConfig` under the `default` import path.

```ts
import {chainConfig} from "@chainsafe/lodestar-config/default";

chainConfig.SECONDS_PER_SLOT === 12;
```

There are also utility functions to help create a `IChainConfig` from unknown input and partial configs.

```ts
import {createIChainConfig, IChainConfig, parsePartialIChainConfigJson} from "@chainsafe/lodestar-config";

const chainConfigObj: Record<string, unknown> = {
  // Eg: read yaml file into an object
};

const partialChainConfig: Partial<IChainConfig> = parsePartialIChainConfigJson(configObj);

// Fill in the missing values with mainnet default values
const chainConfig: IChainConfig = createIChainConfig(partialChainConfig);
```

### Fork config

The variables described in the spec can be used to assemble a more structured 'fork schedule'. This info is organized as `IForkConfig` in the Lodestar config package. In practice, the `IChainConfig` and `IForkConfig` are usually combined as a `IChainForkConfig`.

A `IForkConfig` provides methods to select the fork info, fork name, fork version, or fork ssz types given a slot. 

```ts
import {GENESIS_SLOT} from "@chainsafe/lodestar-params";
import {createIChainForkConfig, IChainConfig, IChainForkConfig} from "@chainsafe/lodestar-config";

let chainConfig: IChainConfig;

const config: IChainForkConfig = createIChainForkConfig(chainConfig);

const version = config.getForkVersion(GENESIS_SLOT);
```

### Cached genesis

For signing Ethereum consensus objects, a cryptographic "domain" is computed and mixed into the signed message. This domain separates signatures made for the Ethereum mainnet from testnets or other instances of the chain. The `ICachedGenesis` interface is used to provide a cache for this purpose. Practically, the domain rarely changes, only per-fork, and so the value can be easily cached. Since the genesis validators root is part of the domain, it is required input to instantiate an `ICachedGenesis`. In practice, the `IChainForkConfig` and `ICachedGenesis` are usually combined as a `IBeaconConfig`. This is the 'highest level' object exported by the Lodestar config library.

```ts
import {DOMAIN_DEPOSIT, GENESIS_SLOT} from "@chainsafe/lodestar-params";
import {createIBeaconConfig, IBeaconConfig, IChainConfig} from "@chainsafe/lodestar-config";

let chainConfig: Partial<IChainConfig>;
let genesisValidatorsRoot: Uint8Array;

const config: IBeaconConfig = createIBeaconConfig(chainConfig, genesisValidatorsRoot);

const domain = config.getDomain(DOMAIN_DEPOSIT, GENESIS_SLOT);
```

## License

Apache-2.0 [ChainSafe Systems](https://chainsafe.io)
