/**
 * @module chain/stateTransition/util
 */

import {hash} from "@chainsafe/ssz";
import {allForks, ValidatorIndex} from "@chainsafe/lodestar-types";
import {assert, intToBytes, intDiv} from "@chainsafe/lodestar-utils";
import {MAX_EFFECTIVE_BALANCE} from "@chainsafe/lodestar-params";

import {computeShuffledIndex} from "./seed";

/**
 * Return from ``indices`` a random index sampled by effective balance.
 *
 * SLOW CODE - 🐢
 */
export function computeProposerIndex(
  state: allForks.BeaconState,
  indices: ValidatorIndex[],
  seed: Uint8Array
): ValidatorIndex {
  assert.gt(indices.length, 0, "Validator indices must not be empty");

  // TODO: Inline outside this function
  const MAX_RANDOM_BYTE = BigInt(2 ** 8 - 1);

  let i = 0;
  /* eslint-disable-next-line no-constant-condition */
  while (true) {
    const candidateIndex = indices[computeShuffledIndex(i % indices.length, indices.length, seed)];
    const randByte = hash(Buffer.concat([seed, intToBytes(intDiv(i, 32), 8)]))[i % 32];
    // TODO: Use a fast cache to get the effective balance 🐢
    const effectiveBalance = state.validators[candidateIndex].effectiveBalance;
    if (effectiveBalance * MAX_RANDOM_BYTE >= MAX_EFFECTIVE_BALANCE * BigInt(randByte)) {
      return candidateIndex;
    }
    i += 1;
    if (i === indices.length) {
      return -1;
    }
  }
}
