# lodestar-config

[![npm](https://img.shields.io/npm/v/@chainsafe/lodestar-config)](https://www.npmjs.com/package/@chainsafe/lodestar-config)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
![ETH2.0_Spec_Version 0.12.1](https://img.shields.io/badge/ETH2.0_Spec_Version-0.12.1-2e86c1.svg)
![ES Version](https://img.shields.io/badge/ES-2020-yellow)
![Node Version](https://img.shields.io/badge/node-12.x-green)

> This package is part of [ChainSafe's Lodestar](https://lodestar.chainsafe.io) project

Configuration variables for an Eth2 network -- consists of params and ssz types (from [lodestar-params](https://github.com/ChainSafe/lodestar/tree/master/packages/params) and [lodestar-types](https://github.com/ChainSafe/lodestar/tree/master/packages/types) respectively).

## Usage

```typescript
// mainet and minimal presets are available under non-default exports
import {config} from "@chainsafe/lodestar-config/mainnet";
// or
import {config} from "@chainsafe/lodestar-config/minimal";

// params available under `params`
const shardCount = mainnetConfig.params.SHARD_COUNT;

// types available under `types`
const BeaconStateType = mainnetConfig.types.BeaconState;
```

## License

Apache-2.0 [ChainSafe Systems](https://chainsafe.io)
