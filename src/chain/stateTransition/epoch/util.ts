/**
 * @module chain/stateTransition/epoch/util
 */

import assert from "assert";
import {deserialize, hashTreeRoot, serialize} from "@chainsafe/ssz";

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

//SPEC 0.7
// def get_winning_crosslink_and_attesting_indices(state: BeaconState,
//   epoch: Epoch,
//   shard: Shard) -> Tuple[Crosslink, List[ValidatorIndex]]:
// attestations = [a for a in get_matching_source_attestations(state, epoch) if a.data.crosslink.shard == shard]
// crosslinks = list(filter(
//   lambda c: hash_tree_root(state.current_crosslinks[shard]) in (c.parent_root, hash_tree_root(c)),
//   [a.data.crosslink for a in attestations]
// ))
// # Winning crosslink has the crosslink data root with the most balance voting for it (ties broken lexicographically)
// winning_crosslink = max(crosslinks, key=lambda c: (
//   get_attesting_balance(state, [a for a in attestations if a.data.crosslink == c]), c.data_root
// ), default=Crosslink())
// winning_attestations = [a for a in attestations if a.data.crosslink == winning_crosslink]
// return winning_crosslink, get_unslashed_attesting_indices(state, winning_attestations)


export function getWinningCrosslinkAndAttestingIndices(
  state: BeaconState,
  epoch: Epoch,
  shard: Shard
): [Crosslink, ValidatorIndex[]] {

  const attestations = getMatchingSourceAttestations(state, epoch)
    .filter((a) => a.data.crosslink.shard === shard);
  const output = attestations.map((a) => a.data.crosslink);
  const currentCrosslinkRoot = hashTreeRoot(state.currentCrosslinks[shard], Crosslink);
  const crosslinks = output.filter((c) => (
    currentCrosslinkRoot.equals(c.parentRoot) ||
    currentCrosslinkRoot.equals(hashTreeRoot(c, Crosslink))
  ));

  const defultCrossLink: Crosslink= {
    shard: GENESIS_START_SHARD,
    startEpoch: GENESIS_EPOCH,
    endEpoch: GENESIS_EPOCH,
    parentRoot: ZERO_HASH,
    dataRoot: ZERO_HASH,
  };

  if (crosslinks.length === 0) {
    return [defultCrossLink, []];
  }
  const getAttestationsFor = (crosslink: Crosslink) => 
    attestations.filter((a) =>
      serialize(a.data.crosslink, Crosslink).equals(serialize(crosslink, Crosslink)));

  // Winning crosslink has the crosslink data root with the most balance voting
  // for it (ties broken lexicographically)
  const winningCrosslink = crosslinks
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
        if ((deserialize(b.crosslink.dataRoot, uint256) as uint256)
          .gt(deserialize(a.crosslink.dataRoot, uint256) as uint256)) {
          return b;
        }
      }
      return a;
    }).crosslink;
  const winningAttestation = attestations.filter((a) =>
    serialize( a.data.crosslink, Crosslink).equals(serialize(winningCrosslink, Crosslink)));
  return [winningCrosslink, getUnslashedAttestingIndices(state, winningAttestation)];
}
