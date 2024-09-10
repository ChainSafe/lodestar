import {CachedBeaconStateAllForks} from "@lodestar/state-transition";
import {ssz, altair} from "@lodestar/types";
import {BlockGenerationOptionsPhase0, generatePhase0BeaconBlocks} from "./phase0.js";
import {generateSignature} from "./utils.js";

export function generateSyncAggregate(
  state: CachedBeaconStateAllForks,
  block: altair.BeaconBlock
): altair.SyncAggregate {
  return {
    syncCommitteeBits: ssz.altair.SyncCommitteeBits.defaultValue(),
    syncCommitteeSignature: generateSignature(),
  };
}

export interface BlockGenerationOptionsAltair extends BlockGenerationOptionsPhase0 {}

export function generateAltairBeaconBlocks(
  state: CachedBeaconStateAllForks,
  count: number,
  opts?: BlockGenerationOptionsAltair
): altair.BeaconBlock[] {
  const blocks = generatePhase0BeaconBlocks(state, count, opts) as altair.BeaconBlock[];
  for (const block of blocks) {
    block.body.syncAggregate = generateSyncAggregate(state, block);
  }
  return blocks;
}
