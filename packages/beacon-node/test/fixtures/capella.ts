import {CachedBeaconStateAltair, PubkeyCache} from "@lodestar/state-transition";
import {capella} from "@lodestar/types";

export function generateBlsToExecutionChanges(
  pubkeyCache: PubkeyCache,
  state: CachedBeaconStateAltair,
  count: number
): capella.SignedBLSToExecutionChange[] {
  const result: capella.SignedBLSToExecutionChange[] = [];

  for (const validatorIndex of state.epochCtx.proposers) {
    const pubkey = pubkeyCache.getOrThrow(validatorIndex);

    result.push({
      message: {
        fromBlsPubkey: pubkey.toBytes(),
        toExecutionAddress: Buffer.alloc(20),
        validatorIndex,
      },
      signature: Buffer.alloc(96),
    });

    if (result.length >= count) return result;
  }

  return result;
}
