/**
 * @module chain/stateTransition/util
 */

import {hash} from "@chainsafe/ssz";
import {
  BeaconState,
  ValidatorIndex,
} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {assert, intToBytes,intDiv} from "@chainsafe/lodestar-utils";

import {getCurrentEpoch} from "./epoch";
import {getSeed, computeShuffledIndex} from "./seed";
import {DomainType} from "../constants";
import {getActiveValidatorIndices} from ".";




/**
 * Return the beacon proposer index at ``state.slot``.
 */
export function getBeaconProposerIndex(config: IBeaconConfig, state: BeaconState): ValidatorIndex {
  const currentEpoch = getCurrentEpoch(config, state);
  const seed = hash(Buffer.concat([
    getSeed(config, state, currentEpoch, DomainType.BEACON_PROPOSER),
    intToBytes(state.slot, 8)
  ]));
  const indices = getActiveValidatorIndices(state, currentEpoch);
  return computeProposerIndex(config, state, indices, seed);
}

/**
 * Return from ``indices`` a random index sampled by effective balance.
 */
export function computeProposerIndex(
  config: IBeaconConfig,
  state: BeaconState,
  indices: ValidatorIndex[], 
  seed: Uint8Array
): ValidatorIndex {
  assert(indices.length > 0);
  const MAX_RANDOM_BYTE = BigInt(2**8 - 1);
  let i = 0;
  /* eslint-disable-next-line no-constant-condition */
  while (true) {
    const candidateIndex = indices[computeShuffledIndex(config, i % indices.length, indices.length, seed)];
    const randByte = hash(Buffer.concat([
      seed,
      intToBytes(intDiv(i, 32), 8),
    ]))[i % 32];
    const effectiveBalance = state.validators[candidateIndex].effectiveBalance;
    if (effectiveBalance * MAX_RANDOM_BYTE >= (config.params.MAX_EFFECTIVE_BALANCE * BigInt(randByte))) {
      return candidateIndex;
    }
    i += 1;
    if (i === indices.length) {
      return -1;
    }
  }
}
