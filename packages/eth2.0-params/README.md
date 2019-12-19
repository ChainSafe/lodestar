# eth2.0-params

[![npm](https://img.shields.io/npm/v/@chainsafe/eth2.0-types)](https://www.npmjs.com/package/@chainsafe/eth2.0-types) [![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

Parameters for configuring an Eth2 network

## Usage

```typescript
// mainnet and minimal presets are available under non-default exports
import {params as mainnetParams} from "@chainsafe/eth2.0-params/lib/presets/mainnet";
import {params as minimalParams} from "@chainsafe/eth2.0-params/lib/presets/mainnet";

mainnetParams.SHARD_COUNT;

// custom params should follow the IBeaconParams interface

import {IBeaconParams} from "@chainsafe/eth2.0-params";

const testnetParams: IBeaconParams = {
  ...mainnetParams,
  SHARD_COUNT: 4
};
```

## License

Apache-2.0
