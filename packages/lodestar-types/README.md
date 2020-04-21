# lodestar-types
[![npm](https://img.shields.io/npm/v/@chainsafe/lodestar-types)](https://www.npmjs.com/package/@chainsafe/lodestar-types)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
![ETH2.0_Spec_Version 0.11.1](https://img.shields.io/badge/ETH2.0_Spec_Version-0.11.1-2e86c1.svg)


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
// mainnet and minimal types pre-generated under non-default export
import {types as mainnetTypes} from "@chainsafe/lodestar-types/lib/ssz/presets/mainnet";
import {types as minimalTypes} from "@chainsafe/lodestar-types/lib/ssz/presets/mainnet";

mainnetTypes.BeaconState.defaultValue();
minimalTypes.BeaconState.defaultValue();

...

// create your own IBeaconSSZTypes object from an IBeaconParams
import {createIBeaconSSZTypes} from "@chainsafe/lodestar-types";
import {IBeaconParams} from "@chainsafe/lodestar-params";
const testnetParams: IBeaconParams = {
  ...
};

const testnetTypes = createIBeaconSSZTypes(testnetParams);

testnetTypes.BeaconState.defaultValue();
```

## License

Apache-2.0
