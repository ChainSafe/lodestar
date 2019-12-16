# eth2.0-config

[![npm](https://img.shields.io/npm/v/@chainsafe/eth2.0-config)](https://www.npmjs.com/package/@chainsafe/eth2.0-config) [![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

Configuration variables for an Eth2 network -- consists of params and ssz types (from [eth2.0-params](https://github.com/ChainSafe/lodestar/tree/master/packages/eth2.0-params) and [eth2.0-types](https://github.com/ChainSafe/lodestar/tree/master/packages/eth2.0-types) respectively).

## Usage

```typescript
// mainet and minimal presets are available under non-default exports
import {config as mainnetConfig} from "@chainsafe/eth2.0-config/lib/presets/mainnet";
import {config as minimalConfig} from "@chainsafe/eth2.0-config/lib/presets/mainnet";

// params available under `params`

const shardCount = mainnetConfig.params.SHARD_COUNT;

// types available under `types`

const BeaconStateType = mainnetConfig.types.BeaconState;
```

## License

Apache-2.0
