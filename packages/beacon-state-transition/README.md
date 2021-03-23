# lodestar-beacon-state-transition

[![npm](https://img.shields.io/npm/v/@chainsafe/lodestar-beacon-state-transition)](https://www.npmjs.com/package/@chainsafe/lodestar-beacon-state-transition)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
![ETH2.0_Spec_Version 0.12.1](https://img.shields.io/badge/ETH2.0_Spec_Version-0.12.1-2e86c1.svg)
![ES Version](https://img.shields.io/badge/ES-2020-yellow)
![Node Version](https://img.shields.io/badge/node-12.x-green)

> This package is part of [ChainSafe's Lodestar](https://lodestar.chainsafe.io) project

The beacon state transition and state transition utilities

## Usage

```typescript

import {stateTransition} from "@chainsafe/lodestar-beacon-state-transition";
import {BeaconBlock, BeaconState} from "@chainsafe/lodestar-types";
import {mainnetConfig} from "@chainsafe/lodestar-config/mainnet";

const state: BeaconState = {
  ...
};

const block: BeaconBlock = {
  ...
};

let postStateContext: BeaconState;
try {
  postStateContext = stateTransition(mainnetConfig, state, block);
} catch (e) {
  console.log(e);
}
```

## License

Apache-2.0 [ChainSafe Systems](https://chainsafe.io)
