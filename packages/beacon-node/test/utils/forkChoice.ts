import {config} from "@lodestar/config/default";
import {phase0, Slot, ssz, ValidatorIndex} from "@lodestar/types";
import {
  computeEpochAtSlot,
  getTemporaryBlockHeader,
  CachedBeaconStateAllForks,
  processSlots,
} from "@lodestar/state-transition";
import {generateSignedBlock} from "./block.js";

// lightweight state transtion function for this test
export function runStateTransition(
  preState: CachedBeaconStateAllForks,
  signedBlock: phase0.SignedBeaconBlock
): CachedBeaconStateAllForks {
  // Clone state because process slots and block are not pure
  const postState = preState.clone();
  // Process slots (including those with no blocks) since block
  processSlots(postState, signedBlock.message.slot);
  // processBlock
  postState.latestBlockHeader = ssz.phase0.BeaconBlockHeader.toViewDU(
    getTemporaryBlockHeader(config, signedBlock.message)
  );
  return postState;
}

// create a child block/state from a parent block/state and a provided slot
export function makeChild(
  parent: {block: phase0.SignedBeaconBlock; state: CachedBeaconStateAllForks},
  slot: Slot
): {block: phase0.SignedBeaconBlock; state: CachedBeaconStateAllForks} {
  const childBlock = generateSignedBlock({message: {slot}});
  const parentRoot = ssz.phase0.BeaconBlock.hashTreeRoot(parent.block.message);
  childBlock.message.parentRoot = parentRoot;
  const childState = runStateTransition(parent.state, childBlock);
  return {block: childBlock, state: childState};
}

export function createIndexedAttestation(
  source: phase0.Checkpoint,
  target: phase0.SignedBeaconBlock,
  block: phase0.SignedBeaconBlock,
  validatorIndex: ValidatorIndex
): phase0.IndexedAttestation {
  return {
    attestingIndices: [validatorIndex],
    data: {
      slot: block.message.slot,
      index: 0,
      beaconBlockRoot: ssz.phase0.BeaconBlock.hashTreeRoot(block.message),
      source,
      target: createCheckpoint(target),
    },
    signature: Buffer.alloc(96),
  };
}

export function createCheckpoint(block: phase0.SignedBeaconBlock): phase0.Checkpoint {
  return {
    root: ssz.phase0.BeaconBlock.hashTreeRoot(block.message),
    epoch: computeEpochAtSlot(block.message.slot),
  };
}
