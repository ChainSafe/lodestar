/**
 * @module chain/stateTransition/epoch/util
 */

import {Epoch, Gwei, phase0, ValidatorIndex} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {assert} from "@chainsafe/lodestar-utils";

import {
  getAttestingIndices,
  getBlockRoot,
  getBlockRootAtSlot,
  getCurrentEpoch,
  getPreviousEpoch,
  getTotalBalance,
} from "../../../util";

/**
 * When processing attestations, we already only accept attestations that have the correct Casper FFG
 * source checkpoint (specifically, the most recent justified checkpoint that the chain knows about).
 * The goal of this function is to get all attestations that have a correct Casper FFG source. Hence,
 * it can safely just return all the PendingAttestations for the desired epoch (current or previous).
 */
export function getMatchingSourceAttestations(
  config: IBeaconConfig,
  state: phase0.BeaconState,
  epoch: Epoch
): phase0.PendingAttestation[] {
  const currentEpoch = getCurrentEpoch(config, state);
  assert.true(
    epoch === currentEpoch || epoch === getPreviousEpoch(config, state),
    `Too old epoch ${epoch}, current=${currentEpoch}`
  );
  return Array.from(epoch === currentEpoch ? state.currentEpochAttestations : state.previousEpochAttestations);
}

/**
 * Returns the subset of PendingAttestations that have the correct Casper FFG target (ie. the
 * checkpoint that is part of the current chain).
 */
export function getMatchingTargetAttestations(
  config: IBeaconConfig,
  state: phase0.BeaconState,
  epoch: Epoch
): phase0.PendingAttestation[] {
  const blockRoot = getBlockRoot(config, state, epoch);
  return getMatchingSourceAttestations(config, state, epoch).filter((a) =>
    config.types.Root.equals(a.data.target.root, blockRoot)
  );
}

/**
 * Returns the subset of PendingAttestations that have the correct head (ie. they voted for a head
 * that ended up being the head of the chain).
 */
export function getMatchingHeadAttestations(
  config: IBeaconConfig,
  state: phase0.BeaconState,
  epoch: Epoch
): phase0.PendingAttestation[] {
  return getMatchingTargetAttestations(config, state, epoch).filter((a) =>
    config.types.Root.equals(a.data.beaconBlockRoot, getBlockRootAtSlot(config, state, a.data.slot))
  );
}

/**
 * Gets the list of attesting indices from a set of attestations, filtering out the indices that have
 * been slashed. The idea here is that if you get slashed, you are still "technically" part of the
 * validator set (see the note on the validator life cycle (https://github.com/ethereum/annotated-spec/
 * blob/master/phase0/beacon-chain.md#lifecycle) for reasoning why), but your attestations
 * do not get counted.
 */
export function getUnslashedAttestingIndices(
  config: IBeaconConfig,
  state: phase0.BeaconState,
  attestations: phase0.PendingAttestation[]
): ValidatorIndex[] {
  const output: Set<ValidatorIndex> = new Set();

  for (const a of attestations) {
    for (const index of getAttestingIndices(config, state, a.data, a.aggregationBits)) {
      output.add(index);
    }
  }

  return Array.from(output)
    .filter((index) => !state.validators[index].slashed)
    .sort();
}

/**
 * Return the combined effective balance of the set of unslashed validators participating in `attestations`.
 * Note: `getTotalBalance` returns `EFFECTIVE_BALANCE_INCREMENT` Gwei minimum to avoid divisions by zero.
 */
export function getAttestingBalance(
  config: IBeaconConfig,
  state: phase0.BeaconState,
  attestations: phase0.PendingAttestation[]
): Gwei {
  return getTotalBalance(config, state, getUnslashedAttestingIndices(config, state, attestations));
}
