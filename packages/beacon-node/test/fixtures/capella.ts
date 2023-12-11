import {CachedBeaconStateAltair} from "@lodestar/state-transition";
import {capella} from "@lodestar/types";

export function generateBlsToExecutionChanges(
  state: CachedBeaconStateAltair,
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
