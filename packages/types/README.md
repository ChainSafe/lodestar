# lodestar-types

[![npm](https://img.shields.io/npm/v/@chainsafe/lodestar-types)](https://www.npmjs.com/package/@chainsafe/lodestar-types)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
![ETH2.0_Spec_Version 1.0.0](https://img.shields.io/badge/ETH2.0_Spec_Version-1.0.0-2e86c1.svg)
![ES Version](https://img.shields.io/badge/ES-2020-yellow)
![Node Version](https://img.shields.io/badge/node-12.x-green)

> This package is part of [ChainSafe's Lodestar](https://lodestar.chainsafe.io) project

Typescript and SSZ types for Eth2 datastructures

## Usage

#### Using the typescript types

```typescript
import {BeaconState} from "@chainsafe/lodestar-types";

const b: BeaconState = {
  slot: 5,
  ...
};
```

#### Using the ssz types

```typescript
import {ssz} from "@chainsafe/lodestar-types";

ssz.phase0.BeaconState.defaultValue();
ssz.altair.BeaconState.defaultValue();
ssz.allForks.BeaconState.defaultValue();
...

```

## License

Apache-2.0 [ChainSafe Systems](https://chainsafe.io)
