/**
 * @module chain/stateTransition/epoch/util
 */

import assert from "assert";

import {
  BeaconState,
  Epoch,
  Gwei,
  PendingAttestation,
  ValidatorIndex,
} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";

import {
  getAttestingIndices,
  getBlockRoot,
  getBlockRootAtSlot,
  getCurrentEpoch,
  getPreviousEpoch,
  getTotalBalance
} from "../util";


export function getMatchingSourceAttestations(
  config: IBeaconConfig,
  state: BeaconState,
  epoch: Epoch
): PendingAttestation[] {
  const currentEpoch = getCurrentEpoch(config, state);
  assert(epoch === currentEpoch || epoch === getPreviousEpoch(config, state));
  return Array.from(
    epoch === currentEpoch
      ? state.currentEpochAttestations
      : state.previousEpochAttestations
  );
}

export function getMatchingTargetAttestations(
  config: IBeaconConfig,
  state: BeaconState,
  epoch: Epoch
): PendingAttestation[] {
  const blockRoot = getBlockRoot(config, state, epoch);
  return getMatchingSourceAttestations(config, state, epoch)
    .filter((a) => config.types.Root.equals(a.data.target.root, blockRoot));
}

export function getMatchingHeadAttestations(
  config: IBeaconConfig,
  state: BeaconState,
  epoch: Epoch
): PendingAttestation[] {
  return getMatchingSourceAttestations(config, state, epoch)
    .filter((a) => config.types.Root.equals(
      a.data.beaconBlockRoot,
      getBlockRootAtSlot(config, state, a.data.slot)
    ));
}

export function getUnslashedAttestingIndices(
  config: IBeaconConfig,
  state: BeaconState,
  attestations: PendingAttestation[]
): ValidatorIndex[] {
  const output: Set<ValidatorIndex> = new Set();
  attestations.forEach((a) =>
    getAttestingIndices(config, state, a.data, a.aggregationBits).forEach((index) =>
      output.add(index)));
  return Array.from(output).filter((index) => !state.validators[index].slashed).sort();
}

export function getAttestingBalance(
  config: IBeaconConfig,
  state: BeaconState,
  attestations: PendingAttestation[]
): Gwei {
  return getTotalBalance(state, getUnslashedAttestingIndices(config, state, attestations));
}
