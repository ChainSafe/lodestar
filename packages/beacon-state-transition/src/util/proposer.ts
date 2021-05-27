/**
 * @module chain/stateTransition/util
 */

import {hash} from "@chainsafe/ssz";
import {allForks, ValidatorIndex} from "@chainsafe/lodestar-types";
import {assert, intToBytes, intDiv} from "@chainsafe/lodestar-utils";
import {DOMAIN_BEACON_PROPOSER, MAX_EFFECTIVE_BALANCE} from "@chainsafe/lodestar-params";

import {getCurrentEpoch} from "./epoch";
import {getSeed, computeShuffledIndex} from "./seed";
import {getActiveValidatorIndices} from "./validator";

/**
 * Return the beacon proposer index at ``state.slot``.
 */
export function getBeaconProposerIndex(state: allForks.BeaconState): ValidatorIndex {
  const currentEpoch = getCurrentEpoch(state);
  const seed = hash(Buffer.concat([getSeed(state, currentEpoch, DOMAIN_BEACON_PROPOSER), intToBytes(state.slot, 8)]));
  const indices = getActiveValidatorIndices(state, currentEpoch);
  return computeProposerIndex(state, indices, seed);
}

/**
 * Return from ``indices`` a random index sampled by effective balance.
 */
export function computeProposerIndex(
  state: allForks.BeaconState,
  indices: ValidatorIndex[],
  seed: Uint8Array
): ValidatorIndex {
  assert.gt(indices.length, 0, "Validator indices must not be empty");
  const MAX_RANDOM_BYTE = BigInt(2 ** 8 - 1);
  let i = 0;
  /* eslint-disable-next-line no-constant-condition */
  while (true) {
    const candidateIndex = indices[computeShuffledIndex(i % indices.length, indices.length, seed)];
    const randByte = hash(Buffer.concat([seed, intToBytes(intDiv(i, 32), 8)]))[i % 32];
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
