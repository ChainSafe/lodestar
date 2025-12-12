import {CachedBeaconStateAltair, Index2PubkeyCache} from "@lodestar/state-transition";
import {capella} from "@lodestar/types";

export function generateBlsToExecutionChanges(
  index2pubkey: Index2PubkeyCache,
  state: CachedBeaconStateAltair,
  count: number
): capella.SignedBLSToExecutionChange[] {
  const result: capella.SignedBLSToExecutionChange[] = [];

  for (const validatorIndex of state.epochCtx.proposers) {
    result.push({
      message: {
        fromBlsPubkey: index2pubkey[validatorIndex].toBytes(),
        toExecutionAddress: Buffer.alloc(20),
        validatorIndex,
      },
      signature: Buffer.alloc(96),
    });

    if (result.length >= count) return result;
  }

  return result;
}
