/**
 * @module chain/stateTransition/epoch/util
 */

import assert from "assert";
import {deserialize, serialize, hashTreeRoot} from "@chainsafe/ssz";

import {
  BeaconState, PendingAttestation,
  Shard, ValidatorIndex, Gwei, Crosslink, Epoch, AttestationData,
} from "../../../types";
import {
  ZERO_HASH,
  MAX_CROSSLINK_EPOCHS,
  GENESIS_EPOCH
} from "../../../constants";

import {
  getActiveValidatorIndices,
  getCurrentEpoch,
  getTotalBalance,
  getPreviousEpoch,
  getBlockRoot,
  getBlockRootAtSlot,
  getAttestingIndices,
  //TODO unused import
  //slotToEpoch,
  getAttestationDataSlot
} from "../util";


export function getTotalActiveBalance(state: BeaconState): Gwei {
  return getTotalBalance(state, getActiveValidatorIndices(state, getCurrentEpoch(state)));
}

export function getMatchingSourceAttestations(state: BeaconState
  , epoch: Epoch): PendingAttestation[] {
  const currentEpoch = getCurrentEpoch(state);
  assert(epoch === currentEpoch || epoch === getPreviousEpoch(state));
  return epoch === currentEpoch
    ? state.currentEpochAttestations
    : state.previousEpochAttestations;
}

export function getMatchingTargetAttestations(state: BeaconState
  , epoch: Epoch): PendingAttestation[] {
  const blockRoot = getBlockRoot(state, epoch);
  return getMatchingSourceAttestations(state, epoch)
    .filter((a) => a.data.targetRoot.equals(blockRoot));
}

export function getMatchingHeadAttestations(state: BeaconState
  , epoch: Epoch): PendingAttestation[] {
  return getMatchingSourceAttestations(state, epoch)
    .filter((a) => a.data.beaconBlockRoot
      .equals(getBlockRootAtSlot(state, getAttestationDataSlot(state, a.data))));
}

export function getUnslashedAttestingIndices(state: BeaconState
  , attestations: PendingAttestation[]): ValidatorIndex[] {
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

export function getCrosslinkFromAttestationData(state: BeaconState
  , data: AttestationData): Crosslink {
  return {
    epoch: Math.min(
      data.targetEpoch,
      state.currentCrosslinks[data.shard].epoch + MAX_CROSSLINK_EPOCHS
    ),
    previousCrosslinkRoot: data.previousCrosslinkRoot,
    crosslinkDataRoot: data.crosslinkDataRoot,
  };
}

export function getWinningCrosslinkAndAttestingIndices(state: BeaconState
  , epoch: Epoch, shard: Shard): [Crosslink, ValidatorIndex[]] {
  const shardAttestations = getMatchingSourceAttestations(state, epoch)
    .filter((a) => a.data.shard === shard);
  const shardCrosslinks = shardAttestations
    .map((a) => getCrosslinkFromAttestationData(state, a.data));
  const currentCrosslinkRoot = hashTreeRoot(state.currentCrosslinks[shard], Crosslink); 
  const candidateCrosslinks = shardCrosslinks.filter((c) => (
    currentCrosslinkRoot.equals(c.previousCrosslinkRoot) ||
    currentCrosslinkRoot.equals(hashTreeRoot(c, Crosslink))
  ));

  if (candidateCrosslinks.length === 0) {
    return [{
      epoch: GENESIS_EPOCH,
      previousCrosslinkRoot: ZERO_HASH,
      crosslinkDataRoot: ZERO_HASH,
    }, []];
  }

  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  const getAttestationsFor = (crosslink: Crosslink) =>
    shardAttestations.filter((a) =>
      serialize(getCrosslinkFromAttestationData(state, a.data), Crosslink)
        .equals(serialize(crosslink, Crosslink)));

  // Winning crosslink has the crosslink data root with the most balance voting
  // for it (ties broken lexicographically)
  const winningCrosslink = candidateCrosslinks
    .map((crosslink) => ({
      crosslink,
      balance: getAttestingBalance(
        state,
        getAttestationsFor(crosslink),
      ),
    }))
    .reduce((a, b) => {
      if (b.balance.gt(a.balance)) {
        return b;
      } else if (b.balance.eq(a.balance)) {
        if (deserialize(b.crosslink.crosslinkDataRoot, "uint256")
          .gt(deserialize(a.crosslink.crosslinkDataRoot, "uint256"))) {
          return b;
        }
      }
      return a;
    }).crosslink;
  return [winningCrosslink,
    getUnslashedAttestingIndices(state, getAttestationsFor(winningCrosslink))];
}
