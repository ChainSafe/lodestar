# lodestar-beacon-state-transition

[![npm](https://img.shields.io/npm/v/@chainsafe/lodestar-beacon-state-transition)](https://www.npmjs.com/package/@chainsafe/lodestar-beacon-state-transition)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![Eth Consensus Spec v1.1.10](https://img.shields.io/badge/ETH%20consensus--spec-1.1.10-blue)](https://github.com/ethereum/consensus-specs/releases/tag/v1.1.10)
![ES Version](https://img.shields.io/badge/ES-2020-yellow)
![Node Version](https://img.shields.io/badge/node-16.x-green)

> This package is part of [ChainSafe's Lodestar](https://lodestar.chainsafe.io) project

The beacon state transition and state transition utilities

## Usage

```typescript
import {CachedBeaconStateAllForks, allForks} from "@chainsafe/lodestar-beacon-state-transition";
import {generateEmptySignedBlock} from "../test/utils/block";
import {generateState} from "../test/utils/state";

// dummy test state
const state: CachedBeaconStateAllForks = generateState() as CachedBeaconStateAllForks;

// dummy test block
const block: allForks.SignedBeaconBlock = generateEmptySignedBlock();

let postStateContext: allForks.BeaconState;
try {
  postStateContext = allForks.stateTransition(state, block);
} catch (e) {
  console.log(e);
}
```

## License

Apache-2.0 [ChainSafe Systems](https://chainsafe.io)
