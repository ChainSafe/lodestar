# `@lodestar/era`

> This package is part of [ChainSafe's Lodestar](https://lodestar.chainsafe.io) project

## Usage

This package provides functionality to read and write [era files](https://github.com/eth-clients/e2store-format-specs/blob/main/formats/era.md), which are based on the [e2store format](https://github.com/status-im/nimbus-eth2/blob/stable/docs/e2store.md#introduction).

### Reading/Writing e2s files

```ts
import {open} from "node:fs/promises";
import {e2s} from "@lodestar/era";

const fh = await open("mainnet-xxxxxx-xxxxxxxx.era");
const entry = await e2s.readEntry(fh, 0);
entry.type == e2s.EntryType.Version;
```

### Reading era files

```ts
import {era} from "@lodestar/era";
import {config} from "@lodestar/config/default";

// open reader
const reader = await era.EraReader.open(config, "mainnet-xxxxx-xxxxxxxx.era");

// check number of groups
reader.groups.length === 1;

// read blocks
const slot = reader.groups[0].blocksIndex?.startSlot ?? 0;

// return snappy-frame compressed, ssz-serialized block at slot or null if a skip slot
// throws if out of range
await reader.readCompressedBlock(slot);
// same, but for ssz-serialized block
await reader.readSerializedBlock(slot);
// same but for deserialized block
await reader.readBlock(slot);

// read state(s), one per group
// similar api to blocks, but with an optional eraNumber param for specifying which group's state to read
await reader.readCompressedState();
await reader.readSerializedState();
await reader.readState();
```

### Writing era files

```ts
import {era} from "@lodestar/era";
import {config} from "@lodestar/config/default";
import {SignedBeaconBlock, BeaconState} from "@lodestar/types";

const writer = await era.EraWriter.create(config, "path/to/era", 0);

// similar api to reader, can write compressed, serialized, or deserialized items
// first write all blocks for the era
// Assuming `block` is a SignedBeaconBlock
declare const block: SignedBeaconBlock;
await writer.writeBlock(block);
// ...
// then write the state
// Assuming `state` is a BeaconState
declare const state: BeaconState;
await writer.writeState(state);
// if applicable, continue writing eras of blocks and state (an era file can contain multiple eras, or "groups" as the spec states)
// when finished, must call `finish`, which will close the file handler and rename the file to the spec-compliant name
await writer.finish();
```

## License

Apache-2.0 [ChainSafe Systems](https://chainsafe.io)
