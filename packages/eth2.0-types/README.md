# eth2.0-types
[![npm](https://img.shields.io/npm/v/@chainsafe/eth2.0-types)](https://www.npmjs.com/package/@chainsafe/eth2.0-types) [![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

Typescript and SSZ types for Eth2 datastructures

## Usage

#### Using the typescript types

```typescript
import {BeaconState} from "@chainsafe/eth2.0-types";

const b: BeaconState = {
  slot: 5,
  ...
};
```

#### Using the ssz types

```typescript
// mainnet and minimal types pre-generated under non-default export
import {types as mainnetTypes} from "@chainsafe/eth2.0-types/lib/ssz/presets/mainnet";
import {types as minimaltTypes} from "@chainsafe/eth2.0-types/lib/ssz/presets/mainnet";

import {defaultValue} from "@chainsafe/ssz";

defaultValue(mainnetTypes.BeaconState);
defaultValue(minimalTypes.BeaconState);

...

// create your own IBeaconSSZTypes object from an IBeaconParams
import {createIBeaconSSZTypes} from "@chainsafe/eth2.0-types";
import {IBeaconParams} from "@chainsafe/eth2.0-params";
const testnetParams: IBeaconParams = {
  ...
};

const testnetTypes = createIBeaconSSZTypes(testnetParams);

defaultValue(testnetTypes.BeaconState);
```

## License

Apache-2.0
