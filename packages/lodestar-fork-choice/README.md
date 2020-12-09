# lodestar-fork-choice

> This package is part of [ChainSafe's Lodestar](https://lodestar.chainsafe.io) project

## Usage

```javascript=
import {ForkChoice, fromGenesis, fromCheckpointState, ProtoArray} from "@chainsafe/lodestar-fork-choice";
import {createIBeaconConfig} from "@chainsafe/lodestar-config";

// eth2 parameter file
import {params} from "@chainsafe/lodestar-params/mainnet";

import {toHexString} from "@chainsafe/ssz";

const config = createIBeaconConfig({params}); // see @chainsafe/lodestar-config for more info
let someExistingBlockData = {
  // block data from somewhere to initialize the fork choice
  // ArrayBuffer(0) is just a placeholder
  blockHeader: Buffer(32),
  finalizedCheckpoint: {checkpoint: Buffer(32)}
};

const blockHeader = someExistingBlockData.blockHeader;
const checkpoint = someExistingBlockData.checkpoint;
const finalizedCheckpoint = {...checkpoint};
const justifiedCheckpoint = {
  ...checkpoint,
  // If not genesis epoch, justified checkpoint epoch must be set to finalized checkpoint epoch + 1
  // So that we don't allow the chain to initially justify with a block that isn't also finalizing the anchor state.
  // If that happens, we will create an invalid head state,
  // with the head not matching the fork choice justified and finalized epochs.
  epoch: checkpoint.epoch === 0 ? checkpoint.epoch : checkpoint.epoch + 1,
};
const fcStore = {
  currentSlot: someExistingSlotData,
  justifiedCheckpoint,
  finalizedCheckpoint,
  bestJustifiedCheckpoint: justifiedCheckpoint,
};

const protoArray = ProtoArray.initialize({
  slot: blockHeader.slot,
  parentRoot: toHexString(blockHeader.parentRoot),
  stateRoot: toHexString(blockHeader.stateRoot),
  blockRoot: toHexString(checkpoint.root),
  justifiedEpoch: justifiedCheckpoint.epoch,
  finalizedEpoch: finalizedCheckpoint.epoch,
});

// create a new ForkChoice object from constructor
const forkChoice = new ForkChoice({
  config,
  fcStore,
  protoArray,
  queuedAttestations: new Set(),
});

// some genesis block data
// Buffer(32) is a placeholder
const genesisBlock = Buffer(32);
// create a new ForkChoice from a given genesis state
const forkChoiceFromGenesis = fromGenesis(
  config,
  fcStore,
  genesisBlock,
);

// some known genesis beacon state or weak-subjectivity state
let anchorState;
const forkChoiceFromCheckpointState = fromCheckpointState(
  config,
  fcStore,
  anchorState,
);
```

## License

Apache-2.0 [ChainSafe Systems](https://chainsafe.io)
