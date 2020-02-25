# lodestar-beacon-state-transition
[![npm](https://img.shields.io/npm/v/@chainsafe/lodestar-beacon-state-transition)](https://www.npmjs.com/package/@chainsafe/lodestar-beacon-state-transition) [![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

The beacon state transition and state transition utilities

## Usage

```typescript

import {stateTransition} from "@chainsafe/lodestar-beacon-state-transition";
import {BeaconBlock, BeaconState} from "@chainsafe/lodestar-types";
import {config as mainnetConfig} from "@chainsafe/lodestar-config/lib/presets/mainnet";

const state: BeaconState = {
  ...
};

const block: BeaconBlock = {
  ...
};

let postState: BeaconState;
try {
  postState = stateTransition(mainnetConfig, state, block);
} catch (e) {
  console.log(e);
}
```

## License

Apache-2.0
