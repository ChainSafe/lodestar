# lodestar-params

[![npm](https://img.shields.io/npm/v/@chainsafe/lodestar-types)](https://www.npmjs.com/package/@chainsafe/lodestar-types)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
![ETH2.0_Spec_Version 0.12.1](https://img.shields.io/badge/ETH2.0_Spec_Version-0.12.1-2e86c1.svg)
![ES Version](https://img.shields.io/badge/ES-2020-yellow)
![Node Version](https://img.shields.io/badge/node-12.x-green)

> This package is part of [ChainSafe's Lodestar](https://lodestar.chainsafe.io) project

Parameters for configuring an Eth2 network

## Usage

```typescript
// mainnet and minimal presets are available under non-default exports
import {params as mainnetParams} from "@chainsafe/lodestar-params/mainnet";
import {params as minimalParams} from "@chainsafe/lodestar-params/mainnet";

mainnetParams.SHARD_COUNT;

// custom params should follow the IBeaconParams interface

import {IBeaconParams} from "@chainsafe/lodestar-params";

const testnetParams: IBeaconParams = {
  ...mainnetParams,
  SHARD_COUNT: 4,
};
```

## License

Apache-2.0 [ChainSafe Systems](https://chainsafe.io)
