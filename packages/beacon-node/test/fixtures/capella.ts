import {CachedBeaconStateAllForks} from "@lodestar/state-transition";
import {ssz, bellatrix, capella} from "@lodestar/types";
import {BlockGenerationOptionsBellatrix, generateBellatrixBeaconBlocks} from "./bellatrix.js";

export function generateCapellaExecutionPayload(payload: bellatrix.ExecutionPayload): capella.ExecutionPayload {
  return {
    ...payload,
    withdrawals: [ssz.capella.Withdrawal.defaultValue()],
  };
}

export function generateBlsToExecutionChanges(
  state: CachedBeaconStateAllForks,
  count: number
): capella.SignedBLSToExecutionChange[] {
  const result: capella.SignedBLSToExecutionChange[] = [];

  for (const validatorIndex of state.epochCtx.proposers) {
    result.push({
      message: {
        fromBlsPubkey: state.epochCtx.index2pubkey[validatorIndex].toBytes(),
        toExecutionAddress: Buffer.alloc(20),
        validatorIndex,
      },
      signature: Buffer.alloc(96),
    });

    if (result.length >= count) return result;
  }

  return result;
}

export interface BlockGenerationOptionsCapella extends BlockGenerationOptionsBellatrix {}

export function generateCapellaBeaconBlocks(
  state: CachedBeaconStateAllForks,
  count: number,
  opts?: BlockGenerationOptionsCapella
): capella.BeaconBlock[] {
  const blocks = generateBellatrixBeaconBlocks(state, count, opts) as capella.BeaconBlock[];
  for (const block of blocks) {
    block.body.executionPayload = generateCapellaExecutionPayload(block.body.executionPayload);
    block.body.blsToExecutionChanges = generateBlsToExecutionChanges(state, count);
  }
  return blocks;
}
