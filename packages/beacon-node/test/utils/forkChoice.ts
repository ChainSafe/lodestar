import {computeEpochAtSlot} from "@lodestar/state-transition";
import {phase0, ssz, ValidatorIndex} from "@lodestar/types";

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
