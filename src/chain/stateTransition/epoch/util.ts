/**
 * @module chain/stateTransition/epoch/util
 */

import assert from "assert";
import {deserialize, hashTreeRoot, equals} from "@chainsafe/ssz";

import {
  BeaconState, PendingAttestation,
  Shard, ValidatorIndex, Gwei, Crosslink, Epoch,
  uint256,
} from "../../../types";
import {
  ZERO_HASH,
  GENESIS_EPOCH, GENESIS_START_SHARD
} from "../../../constants";

import {
  getActiveValidatorIndices, getCurrentEpoch, getTotalBalance, getPreviousEpoch, getBlockRoot,
  getBlockRootAtSlot, getAttestingIndices, getAttestationDataSlot
} from "../util";


export function getTotalActiveBalance(state: BeaconState): Gwei {
  return getTotalBalance(state, getActiveValidatorIndices(state, getCurrentEpoch(state)));
}

export function getMatchingSourceAttestations(
  state: BeaconState,
  epoch: Epoch
): PendingAttestation[] {
  const currentEpoch = getCurrentEpoch(state);
  assert(epoch === currentEpoch || epoch === getPreviousEpoch(state));
  return epoch === currentEpoch
    ? state.currentEpochAttestations
    : state.previousEpochAttestations;
}

export function getMatchingTargetAttestations(
  state: BeaconState,
  epoch: Epoch
): PendingAttestation[] {
  const blockRoot = getBlockRoot(state, epoch);
  return getMatchingSourceAttestations(state, epoch)
    .filter((a) => a.data.targetRoot.equals(blockRoot));
}

export function getMatchingHeadAttestations(
  state: BeaconState,
  epoch: Epoch
): PendingAttestation[] {
  return getMatchingSourceAttestations(state, epoch)
    .filter((a) => a.data.beaconBlockRoot
      .equals(getBlockRootAtSlot(state, getAttestationDataSlot(state, a.data))));
}

export function getUnslashedAttestingIndices(
  state: BeaconState,
  attestations: PendingAttestation[]
): ValidatorIndex[] {
  const output: Set<ValidatorIndex> = new Set();
  attestations.forEach((a) =>
    getAttestingIndices(state, a.data, a.aggregationBitfield).forEach((index) =>
      output.add(index)));
  return Array.from(output)
    .filter((index) => !state.validatorRegistry[index].slashed)
    .sort();
}

export function getAttestingBalance(state: BeaconState, attestations: PendingAttestation[]): Gwei {
  return getTotalBalance(state, getUnslashedAttestingIndices(state, attestations));
}

export function getWinningCrosslinkAndAttestingIndices(
  state: BeaconState,
  epoch: Epoch,
  shard: Shard
): [Crosslink, ValidatorIndex[]] {

  const attestations = getMatchingSourceAttestations(state, epoch)
    .filter((a) => a.data.crosslink.shard === shard);
  const currentCrosslinkRoot = hashTreeRoot(state.currentCrosslinks[shard], Crosslink);
  const crosslinks = attestations.filter((a) => (
    currentCrosslinkRoot.equals(a.data.crosslink.parentRoot) ||
    currentCrosslinkRoot.equals(hashTreeRoot(a.data.crosslink, Crosslink))
  )).map((a) => a.data.crosslink);

  const defaultCrossLink: Crosslink = {
    shard: GENESIS_START_SHARD,
    startEpoch: GENESIS_EPOCH,
    endEpoch: GENESIS_EPOCH,
    parentRoot: ZERO_HASH,
    dataRoot: ZERO_HASH,
  };

  if (crosslinks.length === 0) {
    return [defaultCrossLink, []];
  }

  // Winning crosslink has the crosslink data root with the most balance voting
  // for it (ties broken lexicographically)
  const winningCrosslink = crosslinks
    .map((crosslink) => ({
      crosslink,
      balance: getAttestingBalance(
        state,
        attestations.filter((a) => equals(a.data.crosslink, crosslink, Crosslink)),
      ),
    }))
    .reduce((a, b) => {
      if (b.balance.gt(a.balance)) {
        return b;
      } else if (b.balance.eq(a.balance)) {
        if ((deserialize(b.crosslink.dataRoot, uint256) as uint256)
          .gt(deserialize(a.crosslink.dataRoot, uint256) as uint256)) {
          return b;
        }
      }
      return a;
    }).crosslink;
  const winningAttestations = attestations.filter((a) =>
    equals(a.data.crosslink, winningCrosslink, Crosslink));
  return [winningCrosslink, getUnslashedAttestingIndices(state, winningAttestations)];
}
