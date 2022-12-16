# lodestar-params

[![npm](https://img.shields.io/npm/v/@lodestar/types)](https://www.npmjs.com/package/@lodestar/types)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![Eth Consensus Spec v1.1.10](https://img.shields.io/badge/ETH%20consensus--spec-1.1.10-blue)](https://github.com/ethereum/consensus-specs/releases/tag/v1.1.10)
![ES Version](https://img.shields.io/badge/ES-2020-yellow)
![Node Version](https://img.shields.io/badge/node-18.x-green)

> This package is part of [ChainSafe's Lodestar](https://lodestar.chainsafe.io) project


Lodestar defines all constants and presets defined in the [Ethereum Consensus spec](https://github.com/ethereum/consensus-specs). This can be used in conjunction with other Lodestar libraries to interact with the Ethereum consensus.

## Installation

```sh
npm install @lodestar/params
```

## Usage

The Lodestar params package contains several items used in all downstream Lodestar libraries:

- Fork names
- Constants
- Presets

### Fork names

Many downstream components are namespaced on fork names, or otherwise rely on knowing the fork names ahead of time. The Lodestar params package exports an enum `ForkName` the enumerates all known fork names.

```typescript
import {ForkName} from "@lodestar/params";

// dummy data
let forkName = "phase0";

switch (forkName) {
  case ForkName.phase0:
  case ForkName.altair:
  case ForkName.bellatrix:
  default:
}
```

### Constants

All constants defined in the spec are exported verbatim.

```typescript
import {GENESIS_SLOT} from "@lodestar/params";
```

### Presets

Presets are "constants"-ish defined in the spec that can only be configured at build-time. These are meant to be treated as constants, and indeed are treated as constants by all downstream Lodestar libraries. The default preset is `mainnet`. The only other preset defined is `minimal`, used only in testing environments.

The active preset is exported under the `ACTIVE_PRESET` named export.

```typescript
import {ACTIVE_PRESET, SLOTS_PER_EPOCH} from "@lodestar/params";
```

The preset may be set in one of two ways:

1. by setting the `LODESTAR_PRESET` environment variable
2. by executing the `setActivePreset(preset: Preset)` function

Important Notes:

- Interacting with and understanding the active preset is only necessary in very limited testing environments, eg: for ephemeral testnets
- The `minimal` preset is NOT compatible with the `mainnet` preset.
- using `setActivePreset` may be dangerous, and only should be run once before loading any other libraries. All downstream Lodestar libraries expect the active preset to never change.
- Preset values can be overriden by executing `setActivePreset(presetName: PresetName, overrides?: Partial<BeaconPreset>)` and supplying values to override.

## License

Apache-2.0 [ChainSafe Systems](https://chainsafe.io)
